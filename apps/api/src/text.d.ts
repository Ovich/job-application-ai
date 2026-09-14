/**
 * A text file imported as text, `import prompt from "./prompt.md" with { type: "text" }`:
 * its whole content, as a string (`ID131`, `ID181`).
 *
 * Imported rather than read from disk at run time, so the bundler puts it in the
 * function's bundle: `esbuild --bundle` copies no file a module reads. esbuild reads the
 * attribute itself; the suite's config and the dev server's loader do the same for
 * `vitest` and `tsx` (`vitest.config.ts`, `apps/api/dev/text-import.mjs`).
 *
 * A file that reaches an importer of `*.md` references this one, so a program that
 * reaches the API's source from elsewhere — the web app's, through `AppType` — knows the
 * shape too.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
