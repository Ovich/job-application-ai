import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * So the bundle is built here, from the workflow's own command, on every push. The
 * flags are read out of `deploy.yml` rather than repeated, because a guard that keeps
 * its own copy of the command stops guarding the moment the two drift.
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
  // `pnpm exec esbuild <entry> <flags…>`, and only the flags and the entry are wanted.
  return line.trim().split(/\s+/).slice(3);
};

describe("the API bundle the deploy ships", () => {
  it("builds out of the workflow's own command without one warning", () => {
    const out = mkdtempSync(join(tmpdir(), "api-bundle-"));
    // Everything but where it lands: the workflow's outfile is the artefact's path and
    // this run is only ever asked whether the build is clean.
    const args = esbuildArguments(bundleStep())
      .filter((each) => !each.startsWith("--outfile="))
      .concat(`--outfile=${join(out, "index.mjs")}`);

    const built = spawnSync(
      process.execPath,
      [join(root, "node_modules/esbuild/bin/esbuild"), ...args],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    expect(built.stderr).not.toContain("WARNING");
    expect(built.status).toBe(0);
  }, 60_000);

  it("ships the mock's answer documents beside the bundle", () => {
    // The deployed function is given no `AI_BASE_URL`, so it answers itself and reads
    // these at run time. The zip holds what the step put in `dist/lambda/`, and nothing
    // else puts them there.
    expect(existsSync(join(root, "apps/api/src/lib/mock/documents"))).toBe(true);
    expect(bundleStep()).toContain("apps/api/src/lib/mock/documents");
  });
});
