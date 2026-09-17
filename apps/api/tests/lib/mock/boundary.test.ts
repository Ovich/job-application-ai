import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `AGENTS.md` rules 5 and 6, held by a test rather than by care (`ID294`, `ID295`).
 *
 * Rule 6: the mock's folder is a library in waiting. `index.ts` is its only entry, and
 * nothing under it imports from the application, reads the environment, imports a
 * framework or a client, or names this product. Rule 5: outside that folder, only the
 * binding imports the mock, and only the binding and the bundle name the answers folder.
 */

const api = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repository = resolve(api, "../..");
const library = join(api, "src/lib/mock");

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

describe("the mock's folder, extractable as it stands (rule 6)", () => {
  const sources = filesUnder(library, isSource);

  it("holds the files the claims below are made of", () => {
    expect(sources).toEqual([
      "answers.ts",
      "index.ts",
      "model-mock.ts",
      "pace.ts",
      "protocols/anthropic-messages.ts",
      "protocols/frames.ts",
      "protocols/openai-chat.ts",
      "request.ts",
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

  it("imports no framework, no client and no package at all: the file system alone", () => {
    const packages = new Set(
      sources.flatMap((file) =>
        specifiersOf(join(library, file)).filter((specifier) => !specifier.startsWith(".")),
      ),
    );

    expect([...packages].sort()).toEqual(["node:fs", "node:path"]);
  });

  it("reads no environment", () => {
    expect(
      sources.filter((file) =>
        /process\.env|import\.meta\.env|\benv\./.test(sourceOf(join(library, file))),
      ),
    ).toEqual([]);
  });

  it("names neither this product nor a framework, its README included", () => {
    const every = filesUnder(library, () => true).filter((file) => /\.(ts|md|json)$/.test(file));

    expect(every).toContain("README.md");
    expect(every.filter((file) => /jobapp|\bhono\b/i.test(sourceOf(join(library, file))))).toEqual(
      [],
    );
  });

  it("holds no answers of this project's: they are data the binding points it at", () => {
    expect(filesUnder(library, (file) => file.endsWith(".json"))).toEqual([]);
  });
});

describe("who knows a mock exists (rule 5)", () => {
  const trees = ["apps/api/src", "apps/web/src"] as const;

  const outside = trees.flatMap((tree) =>
    filesUnder(join(repository, tree), isSource)
      .map((file) => `${tree}/${file}`)
      .filter(
        (file) =>
          !file.startsWith("apps/api/src/lib/mock/") &&
          !file.startsWith("apps/api/src/mock-answers/"),
      ),
  );

  it("has sources to read at all, so the claims below cannot pass on an empty list", () => {
    expect(outside.length).toBeGreaterThan(50);
    expect(outside).toContain("apps/api/src/routes/mock.ts");
  });

  it("lets the binding alone import the mock, and by its entry", () => {
    const importers = outside.flatMap((file) =>
      specifiersOf(join(repository, file))
        .filter((specifier) => /(^|\/)lib\/mock(\/|$)/.test(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(importers).toEqual(["apps/api/src/routes/mock.ts: ../lib/mock"]);
  });

  it("lets the binding alone name the answers folder, and the bundle step copy it", () => {
    const naming = outside.filter((file) => /mock-answers/.test(sourceOf(join(repository, file))));
    const bundleStep = sourceOf(join(repository, ".github/workflows/deploy.yml"));

    expect(naming).toEqual(["apps/api/src/routes/mock.ts"]);
    expect(bundleStep).toContain("cp -R apps/api/src/mock-answers/documents dist/lambda/documents");
  });

  it("lets `app.ts` alone mount the binding", () => {
    const importers = outside.filter((file) =>
      specifiersOf(join(repository, file)).some((specifier) =>
        /(^|\/)routes\/mock$/.test(specifier),
      ),
    );

    expect(importers).toEqual(["apps/api/src/app.ts"]);
  });
});
