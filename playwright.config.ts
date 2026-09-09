import { defineConfig } from "@playwright/test";

/**
 * The browser checks. They sit outside the unit suite on purpose: the root Vitest
 * config excludes `e2e/`, so the two runners never collect each other's files, and
 * nothing here runs inside `pnpm check`, which must stay green with no server up.
 *
 * Two projects, because the specs answer questions at two different addresses. `local`
 * runs against the dev server, which forwards `/api` to the API on port 3000, so a
 * spec makes same-origin requests exactly as one distribution will serve page and
 * function together. `deployed` runs against the development environment, which is the
 * only place the questions of slice 2 — did a push put this page on the internet, is a
 * real database behind it — can be asked at all. A spec belongs to one of them by its
 * file name, so neither project ever collects the other's work.
 *
 * Both addresses are written here rather than read from the environment because
 * nothing outside the API's configuration module and the schema package's generator
 * config may read it (ID29). This is the file that answers S2.2's question, and the
 * join at S3.7 moves the idle-timeout spec across to `deployed` when there is a
 * distribution to observe.
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
      testMatch: /stream\.spec\.ts$/,
      use: { baseURL: "http://localhost:4200" },
    },
    {
      name: "deployed",
      testMatch: /foundation\.spec\.ts$/,
      use: { baseURL: "https://dev.job-application.app" },
    },
  ],
});
