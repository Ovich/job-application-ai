import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deployedSecrets } from "../../../e2e/support/config";

/**
 * Seam A of agent-consolidation `SL9` (`S9.1`, `ID222`): where the deployed run finds its
 * two values. The environment first, then `.env.deployed` at the root it is pointed at,
 * here a temporary directory standing in for the repository's.
 */
describe("deployedSecrets", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "deployed-secrets-"));
    vi.stubEnv("DEPLOYED_DATABASE_URL", "");
    vi.stubEnv("DEPLOYED_BETTER_AUTH_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const aFile = (url: string, secret: string) =>
    writeFileSync(
      join(root, ".env.deployed"),
      `DEPLOYED_DATABASE_URL='${url}'\nDEPLOYED_BETTER_AUTH_SECRET='${secret}'\n`,
    );

  it("reads .env.deployed when the environment holds neither value", () => {
    aFile("postgres://from-the-file/dev?sslmode=require", "the-file-secret");

    expect(deployedSecrets(root)).toEqual({
      databaseUrl: "postgres://from-the-file/dev?sslmode=require",
      authSecret: "the-file-secret",
    });
  });

  it("takes a value already in the environment over the file, as the deploy workflow sets it", () => {
    aFile("postgres://from-the-file/dev", "the-file-secret");
    vi.stubEnv("DEPLOYED_DATABASE_URL", "postgres://from-the-workflow/dev");
    vi.stubEnv("DEPLOYED_BETTER_AUTH_SECRET", "the-workflow-secret");

    expect(deployedSecrets(root)).toEqual({
      databaseUrl: "postgres://from-the-workflow/dev",
      authSecret: "the-workflow-secret",
    });
  });

  it("with neither, names pnpm dev:access and the deploy workflow as the two sources", () => {
    expect(() => deployedSecrets(root)).toThrow(/pnpm dev:access/);
    expect(() => deployedSecrets(root)).toThrow(/deploy workflow/);
  });
});
