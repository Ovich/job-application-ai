import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * What the deploy makes of the API, asked here rather than only in the pipeline.
 *
 * `deploy.yml` runs on `main` alone, so until this file existed the bundle was first
 * built after a merge — and a bundle that cannot be loaded took the development
 * environment down before anybody read the step that had already said so.
 *
 * It has now happened twice, each time differently, which is the shape of this file:
 *
 * - As CommonJS, `import.meta` was empty, and the mock's `new URL(…, import.meta.url)`
 *   threw `Invalid URL` at load. esbuild warned; the workflow did not read the warning.
 * - As ESM, the CommonJS dependencies' `require` had nothing to resolve to, and the
 *   function threw `Dynamic require of "fs" is not supported` at load. **esbuild warned
 *   about nothing at all.**
 *
 * So a warning is a failure here, and passing that is not enough: the bundle is loaded
 * and asked for its handler. A build that emits a file is not a function that runs, and
 * the distribution cannot tell the difference — it falls back to the page and serves a
 * dead API as a site that looks well.
 *
 * The flags are read out of `deploy.yml` rather than repeated, because a guard that
 * keeps its own copy of the command stops guarding the moment the two drift.
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
  // Splitting on whitespace is why no flag in that command may carry a space.
  return line.trim().split(/\s+/).slice(3);
};

/** A value as the shell would have seen it, without the quotes that protected it there. */
const unquoted = (value: string): string =>
  (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))
    ? value.slice(1, -1)
    : value;

/**
 * Those arguments as the library takes them. esbuild's own API rather than its command,
 * because a test that spawns a binary by its path is a test about `node_modules` layout:
 * this one is about the flags.
 */
const optionsFrom = (args: string[], outfile: string) => {
  const entryPoints: string[] = [];
  const flags: Record<string, unknown> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      entryPoints.push(arg);
      continue;
    }
    const [name, ...rest] = arg.slice(2).split("=");
    if (name === undefined || name === "outfile") continue;
    const value = rest.length === 0 ? true : unquoted(rest.join("="));
    // `--banner:js=…` is the one flag whose name carries its own key.
    const [flag, key] = name.split(":");
    if (flag !== undefined && key !== undefined) flags[flag] = { [key]: value };
    else if (flag !== undefined) flags[flag] = value;
  }
  return { entryPoints, ...flags, outfile } as Parameters<typeof build>[0];
};

/** Where the built function is put, with the documents it reads beside it. */
const built = mkdtempSync(join(tmpdir(), "api-bundle-"));
const outfile = join(built, "index.mjs");
let warnings: string[] = [];

beforeAll(async () => {
  const result = await build({
    ...optionsFrom(esbuildArguments(bundleStep()), outfile),
    logLevel: "silent",
  });
  warnings = result.warnings.map((each) => `${each.text} (${each.id})`);
  cpSync(join(root, "apps/api/src/lib/mock/documents"), join(built, "documents"), {
    recursive: true,
  });
}, 180_000);

describe("the API bundle the deploy ships", () => {
  it("builds with the workflow's own flags without one warning", () => {
    // The text, not the count: a failure here has to say which warning, or the next
    // person reads `expected 1 to be 0` and learns nothing.
    expect(warnings).toEqual([]);
  });

  it("loads in a bare Node, and answers with its handler", () => {
    // **In a process of its own, and that is the whole point.** Imported here instead,
    // this passes with a bundle Lambda cannot load: the test runner has a `require` in
    // scope, which is the very thing esbuild's shim looks for before it throws, so the
    // `Dynamic require` failure is invisible in Vitest and fatal in the cloud. A child
    // `node` on the built file is the nearest thing to what the runtime does.
    const probe = join(built, "probe.mjs");
    writeFileSync(
      probe,
      // What the runtime gives the function and this has to stand in for. Without it the
      // module throws on `awslambda` before it reaches anything else — which is how the
      // `Dynamic require` failure stayed hidden when it was checked by hand.
      // The environment is set inside the probe rather than handed to the child, because
      // it is the runtime that sets these on a function and the probe is what stands in
      // for the runtime. What `App-dev.yaml` sets, in the shape `env.ts` demands; none
      // of it is reached at load, the function being asked whether it loads at all.
      `Object.assign(process.env, ${JSON.stringify({
        APP_URL: "https://dev.job-application.app",
        DATABASE_URL: "postgresql://someone:secret@example.com:5432/database",
        STORAGE_URL: "s3://a-bucket",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        MICROSOFT_CLIENT_ID: "id",
        MICROSOFT_CLIENT_SECRET: "secret",
        LINKEDIN_CLIENT_ID: "id",
        LINKEDIN_CLIENT_SECRET: "secret",
        BETTER_AUTH_SECRET: "local_dev_only_not_a_real_secret_00000000",
      })});\n` +
        `globalThis.awslambda = {\n` +
        `  streamifyResponse: (handler) => handler,\n` +
        `  HttpResponseStream: { from: (stream) => stream },\n` +
        `};\n` +
        `const module = await import(${JSON.stringify(pathToFileURL(outfile).href)});\n` +
        `if (typeof module.handler !== "function") {\n` +
        `  throw new Error("the bundle loaded and exported no handler");\n` +
        `}\n`,
      "utf8",
    );

    const ran = spawnSync(process.execPath, [probe], { encoding: "utf8" });

    // The complaint, not the status: a bundle that will not load has already said why,
    // and `expected 1 to be 0` throws that away. Only the thrown lines — Node echoes the
    // source it threw on, and one minified line of a bundle is no use to anybody.
    const complaint = `${ran.stdout}${ran.stderr}`
      .split("\n")
      .map((each) => each.trim())
      .filter((each) => /^[A-Za-z]*Error:/.test(each))
      .join("\n");
    expect(complaint).toBe("");
    expect(ran.status).toBe(0);
  }, 180_000);

  it("ships the mock's answer documents beside the bundle", () => {
    // The deployed function is given no `AI_BASE_URL`, so it answers itself and reads
    // these at run time. The zip holds what the step put in `dist/lambda/`, and nothing
    // else puts them there.
    expect(existsSync(join(root, "apps/api/src/lib/mock/documents"))).toBe(true);
    expect(bundleStep()).toContain("apps/api/src/lib/mock/documents");
  });

  it("carries the profile assistant's prompt inside the bundle, since nothing ships it beside", () => {
    // Imported as text (`ID131`, `ID181`, `ID188`): a prompt read from disk at run time
    // would be absent from the zip, and every call would go out with an empty one.
    const prompt = readFileSync(join(root, "apps/api/src/assistants/profile/prompt.md"), "utf8");
    const opening = prompt.split("\n").find((line) => line.trim() !== "") ?? "";

    expect(opening).not.toBe("");
    expect(readFileSync(outfile, "utf8")).toContain(opening);
  });
});
