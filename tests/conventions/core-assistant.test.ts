import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The core assistant is abstract, and this is what keeps it so (`S7.4`, criterion 20).
 *
 * `apps/web/src/app/assistant/` holds the column, the dock, the prefix and the composer,
 * and they are meant to serve the intake, the CV builder and the cover builder alike.
 * The moment one of them imports a type, a string or a component from a use case's
 * folder, it is that use case's assistant with a longer path and the folder has replaced
 * the seam it was supposed to be. There is no second consumer yet to prove the
 * abstraction, so the direction is what is proved instead.
 *
 * Shared things live where shared things live — `app/ui/` and `app/lib/` — and reaching
 * either is not a violation. Reaching a use case is.
 */

const app = join(import.meta.dirname, "../../apps/web/src/app");
const core = join(app, "assistant");

/** Every folder of `app/` that is one use case's rather than everybody's. */
const useCases = readdirSync(app, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !["assistant", "ui", "lib", "shell", "auth"].includes(name));

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts") || entry.name.endsWith(".html")
        ? [join(dir, entry.name)]
        : [],
  );

/** Where a source of the core reaches outside `app/assistant/`, by the folder it lands in. */
const reaches = sources(core).flatMap((file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/from\s+"([^"]+)"/g)]
    .map(([, specifier]) => specifier)
    .filter((specifier) => specifier?.startsWith("."))
    .map((specifier) => ({
      file: relative(app, file).replaceAll("\\", "/"),
      into: relative(app, join(file, "..", specifier ?? ""))
        .replaceAll("\\", "/")
        .split("/")[0],
    }));
});

describe("the core assistant reaches into no use case (S7.4)", () => {
  it("has a use case to be tested against, so this test cannot pass by finding none", () => {
    expect(useCases).toContain("profile");
  });

  it.each(useCases)("imports nothing from app/%s/", (useCase) => {
    expect(reaches.filter(({ into }) => into === useCase)).toEqual([]);
  });
});
