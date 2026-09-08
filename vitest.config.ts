import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,infra}/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/cdk.out/**", "e2e/**"],
  },
});
