import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * Tests live in `tests/` per workspace member, mirroring that member's own source
     * tree (CLAUDE.md rule 15). The pattern names those directories rather than
     * sweeping the members, so a test file left behind under a `src/` is not quietly
     * collected and the layout is enforced by the tool that runs it.
     *
     * `apps/web` is excluded because Angular's own test target runs its specs, with
     * the compiler in front of them; it follows the same layout.
     */
    include: ["{apps/*,packages/*,infra}/tests/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/cdk.out/**", "e2e/**", "apps/web/**"],
  },
});
