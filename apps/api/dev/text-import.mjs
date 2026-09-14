import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The dev server's loader for a `.md` file imported as text (`with { type: "text" }`),
 * preloaded by `pnpm dev` with `--import`.
 *
 * esbuild reads that attribute for the deployed bundle, and the suite's config does for
 * `vitest`; `tsx` does neither, and runs the file as a module. A synchronous hook,
 * answered before `tsx`'s own loader, hands the content over as a string instead.
 */
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.split("?")[0].endsWith(".md")) {
      return nextLoad(url, context);
    }
    return {
      format: "module",
      source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};`,
      shortCircuit: true,
    };
  },
});
