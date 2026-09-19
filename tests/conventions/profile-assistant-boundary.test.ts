import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The import that must not exist (product-flow-rework `S2.1`, `ID330`, `ID331`), held by
 * a test rather than by care, in the shape `apps/api/tests/lib/agent/boundary.test.ts`
 * already uses for the agent's folder.
 *
 * The assistant has left the intake: `ProfilePage` is one column and nothing on the
 * profile or the documents screens asks anybody anything. Its components, its definition
 * and its tests stay in the tree, because `profile-assistant` will want them back
 * (`ID330`) — and a tree that still holds them is a tree where one `import` quietly puts
 * the column back on a screen it was taken off. So the rule is the direction: **no module
 * under the intake or the profile may reach the assistant**, neither the core
 * (`app/assistant/`) nor the intake's own (`profile/profile-assistant/`), in code or in a
 * template.
 *
 * `profile/profile-assistant/` is itself the exception, and the only one: it *is* the
 * assistant, parked where it will be picked up again.
 */

const app = join(import.meta.dirname, "../../apps/web/src/app");

/** The two trees this rule is about, and the one folder inside them that is the assistant. */
const trees = [join(app, "intake"), join(app, "profile")];
const parked = join(app, "profile/profile-assistant");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.(ts|html)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );

const name = (file: string) => relative(app, file).replaceAll("\\", "/");

/** A source's code: block, line and HTML comments removed, as the other conventions read it. */
const codeOf = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Every file of the intake and the profile but the assistant's own, parked there. */
const theirs = trees.flatMap(sources).filter((file) => relative(parked, file).startsWith(".."));

/** Every specifier a file imports or re-exports from, static or dynamic. */
const specifiersOf = (file: string): string[] =>
  [...codeOf(file).matchAll(/(?:from\s+|import\s*\(\s*)"([^"]+)"/g)].flatMap(([, specifier]) =>
    specifier === undefined ? [] : [specifier],
  );

/** A specifier that lands in the core assistant or in the intake's own. */
const isAssistant = (specifier: string): boolean =>
  /(^|\/)assistant(\/|$)/.test(specifier) || specifier.includes("profile-assistant");

describe("the intake and the profile reach no assistant (S2.1, ID331)", () => {
  it("reads the files the claims below are made of", () => {
    expect(theirs.length).toBeGreaterThan(10);
    expect(theirs.map(name)).not.toContain("profile/profile-assistant/profile-assistant.ts");
    expect(theirs.map(name)).toContain("profile/profile-viewer/profile-viewer.ts");
    expect(theirs.map(name)).toContain("profile/profile-page/profile-page.ts");
  });

  it("imports nothing of the assistant, core or intake's own", () => {
    const reaching = theirs.flatMap((file) =>
      specifiersOf(file)
        .filter(isAssistant)
        .map((specifier) => `${name(file)}: ${specifier}`),
    );

    expect(reaching).toEqual([]);
  });

  it("draws the assistant in no template of theirs", () => {
    const drawing = theirs.filter((file) => /<profile-assistant|<assistant\b/.test(codeOf(file)));

    expect(drawing.map(name)).toEqual([]);
  });

  it("leaves the assistant itself where it is, for the slot that wants it back (ID330)", () => {
    expect(sources(parked).length).toBeGreaterThan(0);
  });
});
