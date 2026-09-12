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
    include: ["{apps/*,packages/*,infra}/tests/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "apps/web/**"],
    /*
     * The API's configuration is read at import and refuses to load without the three
     * provider clients and the library's secret (ID60, ID71), so the suite runs with
     * placeholder ones: nobody's registration, never sent anywhere since no test
     * reaches a provider, and a secret that signs nothing outside this process. The
     * tests that ask what the API does without one unset it themselves
     * (`apps/api/tests/env.test.ts`).
     */
    env: {
      GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      MICROSOFT_CLIENT_ID: "test-microsoft-client-id",
      MICROSOFT_CLIENT_SECRET: "test-microsoft-client-secret",
      LINKEDIN_CLIENT_ID: "test-linkedin-client-id",
      LINKEDIN_CLIENT_SECRET: "test-linkedin-client-secret",
      BETTER_AUTH_SECRET: "test-better-auth-secret-of-a-decent-length",
      /*
       * The mock paces a recorded answer the way a model would, so that the reading
       * screen can be watched behaving as it will in production. A suite must not wait
       * for it: every setting is zero here, which is one chunk, instantly, and a test
       * that wants a slow or a stalled answer asks for it per request with the
       * `X-Jobapp-Mock-Pace` header rather than with a second endpoint (spec D13).
       */
      AI_MOCK_PACE: "tps=0;ttft=0;chunk=0;jitter=0",
    },
  },
});
