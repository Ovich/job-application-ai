import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The assistant architecture's boundaries, read from the sources (assistant-architecture
 * `SL2` to `SL8`; D1, D4, D7, D10 to D15, D17).
 *
 * Behind it: the source trees, read in-process as `core-assistant.test.ts` reads them.
 * Comments are stripped before a name is looked for, so prose may still say "rule" or name
 * the core; only code is held.
 *
 * Not past it: what any module does. The route and component suites own that.
 */

const root = join(import.meta.dirname, "../..");
const api = join(root, "apps/api/src");
const web = join(root, "apps/web/src/app");
const db = join(root, "packages/db/src");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.(ts|html)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

/** A source's code: block, line and HTML comments removed. */
const codeOf = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const name = (file: string) => relative(root, file).replaceAll("\\", "/");

/** The files under `dirs` whose code matches `pattern`. */
const matching = (pattern: RegExp, ...dirs: string[]): string[] =>
  dirs
    .flatMap(sources)
    .filter((file) => pattern.test(codeOf(file)))
    .map(name);

/** The relative imports of one file, as the specifiers are written. */
const importsOf = (file: string): string[] =>
  [...codeOf(file).matchAll(/from\s+"([^"]+)"/g)].map(([, specifier]) => specifier ?? "");

describe("the intake handlers, split by concern (SL2, D13)", () => {
  const exportsOf = (file: string) =>
    [...codeOf(join(api, "handlers", file)).matchAll(/export const (\w+)/g)].map(([, it]) => it);

  it("has handlers/documents export addDocument, listDocuments, removeDocument", () => {
    expect(exportsOf("documents.ts")).toEqual(
      expect.arrayContaining(["addDocument", "listDocuments", "removeDocument"]),
    );
  });

  it("has handlers/reading export readDocuments", () => {
    expect(exportsOf("reading.ts")).toContain("readDocuments");
  });

  it("has handlers/profile export readProfile and profileOf", () => {
    expect(exportsOf("profile.ts")).toEqual(expect.arrayContaining(["readProfile", "profileOf"]));
  });

  it("keeps no handlers/intake module", () => {
    expect(existsSync(join(api, "handlers/intake.ts"))).toBe(false);
  });
});

describe("rules renamed profile concerns (SL3, D14)", () => {
  it("names no ruleKind, ruleSource, rule table, RuleAnswer, keepAsRule or writeItemRule", () => {
    expect(
      matching(
        /\b(ruleKind|ruleSource|RuleAnswer|keepAsRule|writeItemRule)\b|export const rule\b/,
        api,
        web,
        db,
      ),
    ).toEqual([]);
  });

  it("draws no data-rule attribute and gives no Option or Question a rule field", () => {
    expect(matching(/data-rule\b|data-part="rule"|\brule\??:\s/, api, web, db)).toEqual([]);
  });
});

describe("the API core reads no profile (SL4, D10 to D12)", () => {
  it("has lib/agent import no lib/profile-edit and no assistant", () => {
    const reached = sources(join(api, "lib/agent")).flatMap(importsOf);
    expect(reached.filter((it) => /profile-edit|assistants/.test(it))).toEqual([]);
  });

  it("has lib/conversation name no part kind beyond text and the tool parts", () => {
    const kinds = sources(join(api, "lib/conversation")).flatMap((file) =>
      [...codeOf(file).matchAll(/kind\s*(?:===|!==|:)\s*"(\w+)"/g)].map(([, kind]) => kind),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(
      kinds.filter((kind) => !["text", "tool_use", "tool_result"].includes(kind ?? "")),
    ).toEqual([]);
  });

  it("has handlers/conversations import no profile table from @app/db", () => {
    expect(importsOf(join(api, "handlers/conversations.ts"))).not.toContain("@app/db");
  });
});

describe("the LangChain packages' import boundary (langgraph-agent SL4, spec 3.1)", () => {
  /** The API files, as `apps/api/src/...`, whose imports include one `specifier` matches. */
  const importers = (specifier: RegExp): string[] =>
    sources(api)
      .filter((file) => importsOf(file).some((it) => specifier.test(it)))
      .map(name);

  const outside = (files: string[], ...dirs: string[]) =>
    files.filter((file) => !dirs.some((dir) => file.startsWith(`apps/api/src/${dir}/`)));

  it("has langchain and @langchain/langgraph imported by lib/agent alone", () => {
    const reaching = importers(/^(langchain|@langchain\/langgraph)(\/|$)/);
    expect(reaching).toContain("apps/api/src/lib/agent/index.ts");
    expect(outside(reaching, "lib/agent")).toEqual([]);
  });

  it("has @langchain/core/tools imported by lib/agent alone", () => {
    const reaching = importers(/^@langchain\/core\/tools$/);
    expect(reaching).toContain("apps/api/src/lib/agent/index.ts");
    expect(outside(reaching, "lib/agent")).toEqual([]);
  });

  it("has @langchain/core/messages imported by lib/agent and lib/conversation alone", () => {
    const reaching = importers(/^@langchain\/core\/messages$/);
    expect(reaching).toEqual(
      expect.arrayContaining([
        "apps/api/src/lib/agent/index.ts",
        "apps/api/src/lib/conversation/index.ts",
      ]),
    );
    expect(outside(reaching, "lib/agent", "lib/conversation")).toEqual([]);
  });

  it("has no assistant, handler or route import a langchain or @langchain package", () => {
    const reaching = importers(/^(langchain|@langchain\/)/);
    expect(
      reaching.filter((file) => /^apps\/api\/src\/(assistants|handlers|routes)\//.test(file)),
    ).toEqual([]);
  });

  it("has handlers/conversations import no lib/ai", () => {
    const reached = importsOf(join(api, "handlers/conversations.ts"));
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((it) => /\/lib\/ai(\/|$)/.test(it))).toEqual([]);
  });
});

describe("the documents service (SL6, D15)", () => {
  it("is the only caller of api.intake.documents and api.intake.read", () => {
    expect(matching(/api\.intake\.(documents|read)\b/, web)).toEqual([
      "apps/web/src/app/intake/documents/documents.ts",
    ]);
  });
});

describe("the web core's one holder (SL7, D1)", () => {
  it("has AssistantCore provided or injected outside app/assistant by ProfileAssistant alone", () => {
    const outside = matching(/\b(AssistantCore|provideAssistant)\b/, web).filter(
      (file) => !file.startsWith("apps/web/src/app/assistant/"),
    );
    expect(outside).toEqual(["apps/web/src/app/profile/profile-assistant/profile-assistant.ts"]);
  });
});

describe("the web core knows no concrete assistant (SL8, D4, D7, D17)", () => {
  const core = join(web, "assistant");

  it("keeps no ASSISTANT_PARTS and no AssistantPart", () => {
    expect(matching(/\b(ASSISTANT_PARTS|AssistantPart)\b/, core)).toEqual([]);
  });

  it("writes no placeholder copy of its own", () => {
    const concrete = readFileSync(
      join(web, "profile/profile-assistant/profile-assistant.ts"),
      "utf8",
    ).match(/const saySomething = "([^"]+)"/)?.[1];
    expect(concrete).toBeDefined();
    expect(matching(new RegExp(concrete ?? "never"), core)).toEqual([]);
  });

  it("imports nothing from app/guide", () => {
    const reached = sources(core).flatMap((file) =>
      importsOf(file)
        .filter((it) => it.startsWith("."))
        .map((it) => relative(web, join(file, "..", it)).replaceAll("\\", "/")),
    );
    expect(reached.filter((it) => it.startsWith("guide"))).toEqual([]);
  });
});
