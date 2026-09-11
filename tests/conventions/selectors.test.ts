import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A component's or a directive's class is its selector in PascalCase (ID87): the tag
 * `app-notice` is the class `AppNotice`, the attribute `[uiStack]` the class `UiStack`,
 * so a name read in a template is the name to search for in code. The Angular CLI
 * does not do this (`ng g c notice` writes `Notice` for `app-notice`), which is why it
 * is a test and not a habit.
 */

const root = join(import.meta.dirname, "../../apps/web/src/app");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );

/** `app-notice` → `AppNotice`; `[uiStack]` → `UiStack`; `button[hlmBtn], a[hlmBtn]` → `HlmBtn`. */
const expectedClass = (selector: string): string => {
  const first = selector.split(",")[0]?.trim() ?? "";
  const attribute = first.match(/\[([A-Za-z][\w-]*)\]/)?.[1];
  const name = attribute ?? first;
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
};

const declarations = sources(root).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const selector = text.match(/selector:\s*"([^"]+)"/)?.[1];
  const className = text.match(/export class (\w+)/)?.[1];
  return selector && className ? [{ file: file.slice(root.length + 1), selector, className }] : [];
});

describe("selectors and class names", () => {
  it("finds the app's components and directives", () => {
    expect(declarations.length).toBeGreaterThan(10);
  });

  it("names every class after its selector", () => {
    const mismatched = declarations
      .filter(({ selector, className }) => expectedClass(selector) !== className)
      .map(
        ({ file, selector, className }) =>
          `${file}: ${selector} is ${className}, not ${expectedClass(selector)}`,
      );
    expect(mismatched).toEqual([]);
  });
});
