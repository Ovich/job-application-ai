import { defineConfig } from "@playwright/test";

/**
 * The browser checks. They sit outside the unit suite on purpose: the root Vitest
 * config excludes `e2e/`, so the two runners never collect each other's files, and
 * nothing here runs inside `pnpm check`, which must stay green with no server up.
 *
 * The address is the local dev server, which forwards `/api` to the API on port 3000,
 * so a spec makes same-origin requests exactly as one distribution will serve page and
 * function together. It is written here rather than read from the environment because
 * nothing outside the API's configuration module and the schema package's generator
 * config may read it (ID29); pointing these checks at a deployed address is S2.2's
 * decision, and the join at S3.7 is where this file has to answer it.
 *
 * No `webServer` block: bringing the stack up is `pnpm dev`, which also starts the
 * container and applies the migrations. A spec that started servers would hide that.
 */
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4200",
  },
});
