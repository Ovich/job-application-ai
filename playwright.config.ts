import { defineConfig } from "@playwright/test";

/**
 * The end-to-end checks. They sit outside the unit suite on purpose: the root Vitest
 * config excludes `e2e/`, so the two runners never collect each other's files, and
 * nothing here runs inside `pnpm check`, which must stay green with no server up.
 *
 * The health specs open no page: what they measure is the API, the health route
 * answering after a real `select version()` and its stream beating one frame at a time
 * through whatever stands in between, so each drives the API with Playwright's
 * `request` fixture and reads a stream raw (`e2e/support/stream.ts`), which also sees
 * the heartbeat a browser hides. `auth` is the first spec that opens the page: it
 * presses the one button the web app has and follows the browser to Google's door.
 *
 * Two projects, because the specs answer questions at two different addresses. `local`
 * runs against the dev server, which forwards `/api` to the API on port 3000, so a
 * spec makes the same request a page served by that dev server would, through the one
 * proxy that the first real screen will depend on. `deployed` runs against the
 * development environment, which is the only place the questions about the distribution
 * itself — did a push put this on the internet, is a real database behind it, does a
 * stream survive the thing between the function and the reader — can be asked at all.
 *
 * Each project names the files it collects. `health-stream` is named by both: arrival
 * is worth measuring in the quick loop and it is what the distribution can break, and
 * the one test in it that only the distribution can answer skips itself elsewhere.
 * `health` is the deployed project's alone: a merge reaching the cloud, a database
 * behind the function and a deep link coming back as the page are all questions a
 * laptop has nothing to say about.
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
      // `auth` is the local project's alone until S5.5: it opens the page and presses
      // the button, and the cloud has no client app to press it against before then.
      testMatch: /(health-stream|auth)\.spec\.ts$/,
      use: { baseURL: "http://localhost:4200" },
    },
    {
      name: "deployed",
      testMatch: /health(-stream)?\.spec\.ts$/,
      use: { baseURL: "https://dev.job-application.app" },
      // One worker, and the reason is the environment rather than the tests. Nothing
      // here writes any more — the health route only reads — but the specs share one
      // development environment and one measurement is a measurement of time: a
      // stream watched for forty seconds beside three others is measuring the runner
      // as much as the distribution. Locally there is one spec, so `local` stays
      // parallel.
      fullyParallel: false,
      workers: 1,
    },
  ],
});
