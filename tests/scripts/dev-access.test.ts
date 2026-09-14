import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SecretReader, writeDevAccess } from "../../scripts/dev-access";

/**
 * Seam A of agent-consolidation `SL9` (`S9.1`, `ID222`): `pnpm dev:access`. Secrets
 * Manager is stood in by the reader port; the root is a temporary git repository, so the
 * ignore check is git's own and the file lands nowhere near this checkout.
 */
describe("writeDevAccess", () => {
  const databaseUrl = "postgres://someone:a-password@dev.neon.example/jobapp?sslmode=require";
  const authSecret = "a-long-auth-secret-nobody-may-print";

  const secrets: SecretReader = async (id) => {
    if (id === "jobapp/dev/database-url") return databaseUrl;
    if (id === "jobapp/dev/auth") return JSON.stringify({ betterAuthSecret: authSecret });
    throw new Error(`no secret ${id}`);
  };

  let root: string;
  let printed: string;

  const aRepository = (ignores: string | undefined) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    if (ignores !== undefined) writeFileSync(join(root, ".gitignore"), ignores);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dev-access-"));
    printed = "";
    const capture = (chunk: unknown) => {
      printed += String(chunk);
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("writes both values under their names, and prints neither", async () => {
    aRepository(".env\n.env.*\n!.env.example\n");

    await writeDevAccess(secrets, root);

    const written = parseEnv(readFileSync(join(root, ".env.deployed"), "utf8"));
    expect(written).toEqual({
      DEPLOYED_DATABASE_URL: databaseUrl,
      DEPLOYED_BETTER_AUTH_SECRET: authSecret,
    });
    expect(printed).not.toContain(databaseUrl);
    expect(printed).not.toContain(authSecret);
  });

  it("refuses a file git does not ignore, and writes nothing", async () => {
    aRepository("node_modules/\n");

    await expect(writeDevAccess(secrets, root)).rejects.toThrow(/not ignored by git/);
    expect(existsSync(join(root, ".env.deployed"))).toBe(false);
  });

  it("with no AWS session, fails naming aws sso login, and writes nothing", async () => {
    aRepository(".env.*\n");
    const expired: SecretReader = async () => {
      throw new Error("Error when retrieving token from sso: Token has expired and refresh failed");
    };

    const failed = writeDevAccess(expired, root);

    await expect(failed).rejects.toThrow(/aws sso login/);
    expect(existsSync(join(root, ".env.deployed"))).toBe(false);
  });
});
