import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * Tests live in `tests/`, mirroring the source tree they cover.
     * The pattern names those directories rather than sweeping the tree, so a test file
     * left behind under a `src/` is not quietly collected and the layout is enforced by
     * the tool that runs it. `infra` is named alongside the workspace members although
     * it is no longer one: it holds CloudFormation YAML and the tests that read it.
     *
     * `apps/web` is excluded because Angular's own test target runs its specs, with
     * the compiler in front of them; it follows the same layout.
     */
    include: ["{apps/*,packages/*,infra}/tests/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "apps/web/**"],
    /*
     * The API's configuration is read at import and refuses to load without a Google
     * client (ID60), so the suite runs with a placeholder one: nobody's registration,
     * and never sent anywhere, since no test reaches Google. The tests that ask what
     * the API does without one unset it themselves (`apps/api/tests/env.test.ts`).
     */
    env: {
      GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    },
  },
});
