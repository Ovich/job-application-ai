import { defineConfig } from "@playwright/test";

/**
 * The end-to-end checks. They sit outside the unit suite on purpose: the root Vitest
 * config excludes `e2e/`, so the two runners never collect each other's files, and
 * nothing here runs inside `pnpm check`, which must stay green with no server up.
 *
 * No spec opens a page. The web app is an empty shell (S9.1), and what the four checks
 * were ever measuring is the API: a run created and read back, events arriving one at
 * a time, a silent stream staying open, a cut stream resuming. Each spec drives the API
 * with Playwright's `request` fixture and reads a stream raw (`e2e/support/stream.ts`),
 * which also sees the heartbeat a browser hides.
 *
 * Two projects, because the specs answer questions at two different addresses. `local`
 * runs against the dev server, which forwards `/api` to the API on port 3000, so a
 * spec makes the same request a page served by that dev server would, through the one
 * proxy that the first real screen will depend on. `deployed` runs against the
 * development environment, which is the only place the questions about the distribution
 * itself — did a push put this on the internet, is a real database behind it, does a
 * stream survive the thing between the function and the reader — can be asked at all.
 *
 * Each project names the files it collects, so neither ever collects the other's work.
 * `stream` is named by both: arrival is worth measuring in the quick loop and it is
 * what the distribution can break. `foundation` and `idle` are the deployed project's
 * alone, because a laptop has nothing to say about either. `resume` is the local
 * project's alone: what it asks — is a unit's result there after the connection went,
 * does the run carry on from it — is answered by the function and the database, and
 * neither of those is what the distribution changes.
 *
 * Both addresses are written here rather than read from the environment because
 * nothing outside the API's configuration module and the schema package's generator
 * config may read it (ID29). This is the file that answers S2.2's question.
 *
 * No `webServer` block: bringing the stack up is `pnpm dev`, which also starts the
 * container and applies the migrations. A spec that started servers would hide that.
 */
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  projects: [
    {
      name: "local",
      testMatch: /(stream|resume)\.spec\.ts$/,
      use: { baseURL: "http://localhost:4200" },
    },
    {
      name: "deployed",
      testMatch: /(foundation|stream|idle)\.spec\.ts$/,
      use: { baseURL: "https://dev.job-application.app" },
      // One worker, and the reason is the environment rather than the tests. Every spec
      // here creates a run against ONE shared development database, and foundation.spec
      // reads back "the latest run" — so two specs running at once make each other's
      // latest wrong. It passes alone and fails beside stream.spec, which is a race the
      // suite acquired when the join put three run-creating specs into this project.
      // Locally no spec reads the latest run, so `local` stays parallel.
      fullyParallel: false,
      workers: 1,
    },
  ],
});
