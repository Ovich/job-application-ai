import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deployedSecrets } from "../../../e2e/support/config";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Seam A of agent-consolidation `SL9` (`S9.1`, `S9.5`, `ID222`, `ID231`): where the deployed
 * run finds its two values. The environment first, then `.jobapp/dev.env` in the person's
 * profile, here a temporary directory the home variables point at.
 */
describe("deployedSecrets", () => {
  let profile: string;

  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), "deployed-secrets-"));
    vi.stubEnv("USERPROFILE", profile);
    vi.stubEnv("HOME", profile);
    vi.stubEnv("DEPLOYED_DATABASE_URL", "");
    vi.stubEnv("DEPLOYED_BETTER_AUTH_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(profile, { recursive: true, force: true });
  });

  const write = (path: string, url: string, secret: string) =>
    writeFileSync(
      path,
      `DEPLOYED_DATABASE_URL='${url}'\nDEPLOYED_BETTER_AUTH_SECRET='${secret}'\n`,
    );

  const aProfileFile = (url: string, secret: string) => {
    mkdirSync(join(profile, ".jobapp"));
    write(join(profile, ".jobapp", "dev.env"), url, secret);
  };

  it("reads .jobapp/dev.env in the person's profile when the environment holds neither value", () => {
    aProfileFile("postgres://from-the-profile/dev?sslmode=require", "the-profile-secret");

    expect(deployedSecrets()).toEqual({
      databaseUrl: "postgres://from-the-profile/dev?sslmode=require",
      authSecret: "the-profile-secret",
    });
  });

  it("takes a value already in the environment over the file, as the deploy workflow sets it", () => {
    aProfileFile("postgres://from-the-profile/dev", "the-profile-secret");
    vi.stubEnv("DEPLOYED_DATABASE_URL", "postgres://from-the-workflow/dev");
    vi.stubEnv("DEPLOYED_BETTER_AUTH_SECRET", "the-workflow-secret");

    expect(deployedSecrets()).toEqual({
      databaseUrl: "postgres://from-the-workflow/dev",
      authSecret: "the-workflow-secret",
    });
  });

  it("no longer reads a .env.deployed at the repository's root", () => {
    const old = join(repositoryRoot, ".env.deployed");
    // A stand-in only when the checkout has none: a real one is never overwritten here.
    const placed = !existsSync(old);
    if (placed) write(old, "postgres://from-the-checkout/dev", "the-checkout-secret");

    try {
      expect(() => deployedSecrets()).toThrow(/pnpm dev:access/);
    } finally {
      if (placed) rmSync(old, { force: true });
    }
  });

  it("with neither, names pnpm dev:access and the deploy workflow as the two sources", () => {
    expect(() => deployedSecrets()).toThrow(/pnpm dev:access/);
    expect(() => deployedSecrets()).toThrow(/deploy workflow/);
  });
});
