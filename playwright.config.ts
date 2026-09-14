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
      // `auth` and `entry-route` are the local project's alone until S5.5: they open
      // the page, and the cloud has no client app to open before then. `intake` joins
      // them at SL2 and is the local project's alone until SL6: the deployed
      // environment's storage has never been exercised and its AI values are that
      // slice's, so a run there would be a run against a bucket nothing has written to
      // and a mock the template does not yet point at.
      // `profile` joins them at SL3, and `intake-questions` at SL4, both local-only for
      // the same reason `intake` is: the deployed environment's storage has never been
      // exercised and its AI values are SL6's, so a run there would read documents no
      // bucket holds and ask a mock the template does not yet point at.
      // `conversation` joins at agent-consolidation SL2, and both projects collect it from
      // that plan's SL6 (ID178).
      // `dev-sql` is the local project's alone and always will be (agent-consolidation SL9,
      // ID228): it proves `pnpm dev:sql` on the local container, and dev is one shared
      // database nothing but the app may write to.
      testMatch:
        /(health-stream|auth|entry-route|intake|intake-questions|profile|conversation|dev-sql)\.spec\.ts$/,
      use: { baseURL: "http://localhost:4200" },
    },
    {
      name: "deployed",
      // Widened at S5.5 (ID69): the cloud has client apps of its own now, so the specs
      // that open the page and the specs that ask the library who is signed in are
      // questions this address can finally answer — and the only address where origin
      // access control, the payload hash and the session cookie's road through the
      // distribution exist at all. A spec collected by both projects skips what only
      // one address can answer, the way `health-stream` already does.
      //
      // `conversation` is the first product spec it collects (agent-consolidation SL6,
      // ID178). From that plan's SL9 (ID224, ID225) it walks the screens as the local
      // project does: `intake`, `intake-questions` and `conversation`'s screen cases drop
      // the fixture documents into dev's storage and dev's function reads them from the
      // recorded readings it bundles, so the reason they stayed local (ID138) is gone. A
      // spec that drops documents deletes its people through the account deletion route,
      // so the stored objects go with them. `profile` stays local; `dev-sql` never runs here.
      testMatch:
        /(health(-stream)?|auth|entry-route|conversation|intake|intake-questions)\.spec\.ts$/,
      // Nothing recorded, named rather than left to the defaults (agent-consolidation SL9,
      // ID231): a trace carries the signed session cookie and every request's body, and a
      // video or a screenshot what a person's screens on dev showed.
      use: {
        baseURL: "https://dev.job-application.app",
        trace: "off",
        video: "off",
        screenshot: "off",
      },
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
