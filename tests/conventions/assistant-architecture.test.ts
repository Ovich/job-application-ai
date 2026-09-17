import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

  // SL5f, OD7: reading the entries back is the agent's, so it is the agent that names a
  // part kind, and only the three it writes itself; lib/conversation names none at all.
  // `activity` and `entry` are `Ran`'s, what the loop says as it runs, and not parts.
  it("has lib/agent name no part kind beyond text and the tool parts", () => {
    const kinds = sources(join(api, "lib/agent")).flatMap((file) =>
      [...codeOf(file).matchAll(/kind\s*(?:===|!==|:)\s*"(\w+)"/g)].map(([, kind]) => kind),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(
      kinds.filter(
        (kind) => !["text", "tool_use", "tool_result", "activity", "entry"].includes(kind ?? ""),
      ),
    ).toEqual([]);
  });

  it("has handlers/conversations import no profile table from @app/db", () => {
    expect(importsOf(join(api, "handlers/conversations.ts"))).not.toContain("@app/db");
  });
});

describe("the LangChain packages' import boundary (langgraph-agent SL4, SL5, spec 3.1)", () => {
  /** The API files, as `apps/api/src/...`, whose imports include one `specifier` matches. */
  const importers = (specifier: RegExp): string[] =>
    sources(api)
      .filter((file) => importsOf(file).some((it) => specifier.test(it)))
      .map(name);

  const outside = (files: string[], ...dirs: string[]) =>
    files.filter((file) => !dirs.some((dir) => file.startsWith(`apps/api/src/${dir}/`)));

  it("has langchain and @langchain/langgraph imported by lib/agent alone", () => {
    const reaching = importers(/^(langchain|@langchain\/langgraph)(\/|$)/);
    expect(reaching).toContain("apps/api/src/lib/agent/agent.ts");
    expect(outside(reaching, "lib/agent")).toEqual([]);
  });

  it("has @langchain/core/tools imported by lib/agent alone", () => {
    const reaching = importers(/^@langchain\/core\/tools$/);
    expect(reaching).toContain("apps/api/src/lib/agent/agent.ts");
    expect(outside(reaching, "lib/agent")).toEqual([]);
  });

  // SL5b, D30: the reading builds the LangChain messages `askFor` takes.
  const reading = "apps/api/src/handlers/reading.ts";

  it("has @langchain/core/messages imported by lib/agent, lib/ai and the reading alone", () => {
    const reaching = importers(/^@langchain\/core\/messages$/);
    expect(reaching).toEqual(
      expect.arrayContaining([
        "apps/api/src/lib/agent/messages.ts",
        "apps/api/src/lib/ai/client.ts",
        reading,
      ]),
    );
    expect(outside(reaching, "lib/agent", "lib/ai").filter((it) => it !== reading)).toEqual([]);
  });

  // SL5f, ID298: the model is an option the binding passes, so the agent reaches lib/ai
  // not at all, and no client of a provider either.
  it("has lib/agent import no lib/ai, no openai and no @langchain/openai", () => {
    const reached = sources(join(api, "lib/agent")).flatMap(importsOf);
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((it) => /(^|\/)ai(\/|$)/.test(it))).toEqual([]);
    expect(reached.filter((it) => /^(openai|@langchain\/openai)(\/|$)/.test(it))).toEqual([]);
  });

  // SL5, ID272: the history is the agent's to read, so lib/conversation needs no lib/ai type.
  it("has lib/conversation import no lib/ai", () => {
    const reached = sources(join(api, "lib/conversation")).flatMap(importsOf);
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((it) => /(^|\/)ai(\/|$)/.test(it))).toEqual([]);
  });

  // SL5b, D30: lib/ai's public face is D30's list; the openai client's names are gone.
  it("has lib/ai export D30's list and nothing else", () => {
    const code = codeOf(join(api, "lib/ai/index.ts"));
    const exported = [
      ...[...code.matchAll(/export const (\w+)/g)].map(([, it]) => it),
      ...[...code.matchAll(/export \{([^}]*)\}/g)].flatMap(([, list]) =>
        (list ?? "")
          .split(",")
          .map((it) => it.replace(/^\s*type\s+/, "").trim())
          .filter((it) => it !== ""),
      ),
    ];
    expect(exported.sort()).toEqual(
      [
        "About",
        "AiConfig",
        "createChatModel",
        "chatModel",
        "createAskFor",
        "askFor",
        "answeredInProcessBy",
        "answeringOwnAddress",
        "Fetch",
        "OwnAddress",
      ].sort(),
    );
  });
});

describe("lib/ai's importers, each taking only its own name (SL5b, D30, the person's rule)", () => {
  /** Every API file importing lib/ai, with the names it takes, `type` imports included. */
  const namesFromAi = (): Record<string, string[]> =>
    Object.fromEntries(
      sources(api)
        .filter((file) => !file.startsWith(join(api, "lib/ai")))
        .map((file) => {
          const names = [
            ...codeOf(file).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g),
          ]
            .filter(([, , specifier]) =>
              specifier?.startsWith(".")
                ? join(dirname(file), specifier) === join(api, "lib/ai")
                : false,
            )
            .flatMap(([, list]) =>
              (list ?? "")
                .split(",")
                .map((it) => it.replace(/^\s*type\s+/, "").trim())
                .filter((it) => it !== ""),
            );
          return [name(file), names] as const;
        })
        .filter(([, names]) => names.length > 0),
    );

  it("has no assistant and not handlers/conversations import lib/ai", () => {
    const importing = Object.keys(namesFromAi());
    expect(importing.length).toBeGreaterThan(0);
    expect(
      importing.filter(
        (file) =>
          file.startsWith("apps/api/src/assistants/") ||
          file === "apps/api/src/handlers/conversations.ts",
      ),
    ).toEqual([]);
  });

  it("has askFor imported by handlers/reading alone", () => {
    const taking = Object.entries(namesFromAi()).filter(([, names]) => names.includes("askFor"));
    expect(taking.map(([file]) => file)).toEqual(["apps/api/src/handlers/reading.ts"]);
  });

  // SL5f, `AGENTS.md` rule 7: the composition root is the one place that reaches a model.
  it("has chatModel imported by the composition root alone", () => {
    const taking = Object.entries(namesFromAi()).filter(([, names]) => names.includes("chatModel"));
    expect(taking.map(([file]) => file)).toEqual(["apps/api/src/app.ts"]);
  });

  it("has app.ts import answeredInProcessBy and chatModel from lib/ai, and nothing else", () => {
    expect(namesFromAi()["apps/api/src/app.ts"]?.sort()).toEqual([
      "answeredInProcessBy",
      "chatModel",
    ]);
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
