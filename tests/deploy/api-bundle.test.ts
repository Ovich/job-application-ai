import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * What the deploy makes of the API, asked here rather than only in the pipeline.
 *
 * `deploy.yml` runs on `main` alone, so until this file existed the bundle was first
 * built after a merge — and a bundle that cannot be loaded took the development
 * environment down for a day before anybody read the step that had already said so.
 * esbuild prints a warning and writes the artefact anyway; the workflow ignored the
 * warning, CloudFormation reported success, and the distribution's fallback turned the
 * dead function into a page that looked fine and signed nobody in.
 *
 * So the bundle is built here, with the workflow's own flags, on every push. They are
 * read out of `deploy.yml` rather than repeated, because a guard that keeps its own copy
 * of the command stops guarding the moment the two drift.
 *
 * **A warning is a failure.** The one that mattered was `empty-import-meta`: the output
 * format is the thing that decides whether `import.meta.url` is an address or nothing,
 * and a module that resolves its own directory at load time throws `Invalid URL` in the
 * cloud and nowhere else.
 */

const root = join(import.meta.dirname, "../..");

/** The `Bundle the API` step, as the workflow writes it. */
const bundleStep = (): string => {
  const workflow = parse(readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8")) as {
    jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
  };
  const step = workflow.jobs["deploy-dev"]?.steps.find((each) => each.name === "Bundle the API");
  if (step?.run === undefined) throw new Error("deploy.yml has no `Bundle the API` step that runs");
  return step.run;
};

/** The esbuild invocation inside it, its line continuations closed up. */
const esbuildArguments = (script: string): string[] => {
  const line = script
    .replaceAll(/\\\r?\n/g, " ")
    .split("\n")
    .find((each) => each.includes("esbuild"));
  if (line === undefined) throw new Error("the `Bundle the API` step no longer runs esbuild");
  // `pnpm exec esbuild <entry> <flags…>`, and only the entry and the flags are wanted.
  return line.trim().split(/\s+/).slice(3);
};

/**
 * Those arguments as the library takes them. esbuild's own API rather than its command,
 * because a test that spawns a binary by its path is a test about `node_modules` layout:
 * this one is about the flags.
 *
 * `outfile` is dropped with `write: false` — what the bundle is called is the artefact's
 * business, and nothing here is asked to produce one.
 */
const optionsFrom = (args: string[]) => {
  const entryPoints: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      entryPoints.push(arg);
      continue;
    }
    const [name, ...rest] = arg.slice(2).split("=");
    if (name === undefined || name === "outfile") continue;
    flags[name] = rest.length === 0 ? true : rest.join("=");
  }
  return { entryPoints, ...flags, write: false, logLevel: "silent" } as Parameters<typeof build>[0];
};

describe("the API bundle the deploy ships", () => {
  it("builds with the workflow's own flags without one warning", async () => {
    const built = await build(optionsFrom(esbuildArguments(bundleStep())));

    // The text, not the count: a failure here has to say which warning, or the next
    // person reads `expected 1 to be 0` and learns nothing — which is the whole
    // complaint this file exists to answer.
    expect(built.warnings.map((each) => `${each.text} (${each.id})`)).toEqual([]);
  }, 120_000);

  it("ships the mock's answer documents beside the bundle", () => {
    // The deployed function is given no `AI_BASE_URL`, so it answers itself and reads
    // these at run time. The zip holds what the step put in `dist/lambda/`, and nothing
    // else puts them there.
    expect(existsSync(join(root, "apps/api/src/lib/mock/documents"))).toBe(true);
    expect(bundleStep()).toContain("apps/api/src/lib/mock/documents");
  });
});
