import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `AGENTS.md` rules 7 and 8, held by a test rather than by care (`ID298`), as
 * `tests/lib/mock/boundary.test.ts` holds rules 5 and 6.
 *
 * Rule 8: the agent's folder is a library in waiting. `index.ts` is its only entry, and
 * nothing under it imports from the application, reads the environment or names this
 * product; its packages are LangChain's and zod. Rule 7: outside that folder, only the
 * composition root builds the agent, and its callers are handed the instance.
 */

const api = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repository = resolve(api, "../..");
const library = join(api, "src/lib/agent");

const filesUnder = (root: string, keep: (file: string) => boolean): string[] =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.includes("node_modules/") && keep(file))
    .sort();

const isSource = (file: string) => file.endsWith(".ts");
const sourceOf = (file: string) => readFileSync(file, "utf8");

/** Every specifier a file imports or re-exports from, static or dynamic. */
const specifiersOf = (file: string): string[] =>
  [...sourceOf(file).matchAll(/(?:from\s+|import\s*\(\s*|import\s+)"([^"]+)"/g)].flatMap(
    ([, specifier]) => (specifier === undefined ? [] : [specifier]),
  );

describe("the agent's folder, extractable as it stands (rule 8)", () => {
  const sources = filesUnder(library, isSource);

  it("holds the files the claims below are made of (OD8)", () => {
    expect(sources).toEqual([
      "agent.ts",
      "calls.ts",
      "context.ts",
      "index.ts",
      "messages.ts",
      "step.ts",
    ]);
  });

  it("imports nothing from the application: every relative import stays inside the folder", () => {
    const leaving = sources.flatMap((file) =>
      specifiersOf(join(library, file))
        .filter((specifier) => specifier.startsWith("."))
        .filter((specifier) =>
          relative(library, resolve(dirname(join(library, file)), specifier)).startsWith(".."),
        )
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(leaving).toEqual([]);
  });

  it("imports its own packages alone: LangChain's and zod, and no database and no client", () => {
    const packages = new Set(
      sources.flatMap((file) =>
        specifiersOf(join(library, file)).filter((specifier) => !specifier.startsWith(".")),
      ),
    );

    expect([...packages].sort()).toEqual([
      "@langchain/core/language_models/chat_models",
      "@langchain/core/messages",
      "@langchain/core/tools",
      "langchain",
      "zod",
    ]);
  });

  it("reads no environment", () => {
    expect(
      sources.filter((file) =>
        /process\.env|import\.meta\.env|\benv\./.test(sourceOf(join(library, file))),
      ),
    ).toEqual([]);
  });

  it("names neither this product nor a framework", () => {
    const every = filesUnder(library, () => true).filter((file) => /\.(ts|md|json)$/.test(file));

    expect(every.length).toBeGreaterThan(0);
    expect(every.filter((file) => /jobapp|\bhono\b/i.test(sourceOf(join(library, file))))).toEqual(
      [],
    );
  });

  it("is reached from outside by its entry alone (rule 8)", () => {
    const outside = ["apps/api/src", "apps/web/src"].flatMap((tree) =>
      filesUnder(join(repository, tree), isSource)
        .map((file) => `${tree}/${file}`)
        .filter((file) => !file.startsWith("apps/api/src/lib/agent/")),
    );
    expect(outside.length).toBeGreaterThan(50);

    const reaching = outside.flatMap((file) =>
      specifiersOf(join(repository, file))
        .filter((specifier) => /(^|\/)lib\/agent(\/|$)|^\.\.\/agent$/.test(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(reaching).toEqual([
      "apps/api/src/app.ts: ./lib/agent",
      "apps/api/src/lib/assistant/index.ts: ../agent",
      "apps/api/src/lib/profile-edit/index.ts: ../agent",
    ]);
  });
});
