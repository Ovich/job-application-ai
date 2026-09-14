import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OwnerOnly, type SecretReader, writeDevAccess } from "../../scripts/dev-access";

/**
 * Seam A of agent-consolidation `SL9` (`S9.1`, `S9.5`, `ID222`, `ID231`): `pnpm dev:access`.
 * Secrets Manager is stood in by the reader port and `icacls` / `chmod` by the owner-only
 * port; the file lands in a temporary directory standing in for the person's profile.
 */
describe("writeDevAccess", () => {
  const databaseUrl =
    "postgres://someone:a%2Fpass%40word@ep-dev.neon.example:6543/jobapp?sslmode=require";
  const password = "a/pass@word";
  const authSecret = "a-long-auth-secret-nobody-may-print";

  const secrets: SecretReader = async (id) => {
    if (id === "jobapp/dev/database-url") return databaseUrl;
    if (id === "jobapp/dev/auth") return JSON.stringify({ betterAuthSecret: authSecret });
    throw new Error(`no secret ${id}`);
  };

  let profile: string;
  let file: string;
  let printed: string;
  /** What the file held each time the owner-only port was asked to close it. */
  let heldWhenClosed: string[];

  const closes: OwnerOnly = async (path) => {
    heldWhenClosed.push(readFileSync(path, "utf8"));
  };

  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), "dev-access-"));
    file = join(profile, ".jobapp", "dev.env");
    printed = "";
    heldWhenClosed = [];
    const capture = (chunk: unknown) => {
      printed += String(chunk);
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(profile, { recursive: true, force: true });
  });

  it("writes both values and the connection split for psql under their names, and prints none", async () => {
    await writeDevAccess(secrets, file, closes);

    const written = parseEnv(readFileSync(file, "utf8"));
    expect(written).toEqual({
      DEPLOYED_DATABASE_URL: databaseUrl,
      DEPLOYED_BETTER_AUTH_SECRET: authSecret,
      PGHOST: "ep-dev.neon.example",
      PGPORT: "6543",
      PGDATABASE: "jobapp",
      PGUSER: "someone",
      PGPASSWORD: password,
      PGSSLMODE: "require",
    });
    expect(printed).not.toContain(databaseUrl);
    expect(printed).not.toContain(password);
    expect(printed).not.toContain(authSecret);
  });

  it("closes the file to its owner while it is still empty, before any value is in it", async () => {
    await writeDevAccess(secrets, file, closes);

    expect(heldWhenClosed).toEqual([""]);
  });

  it("fails when the file cannot be closed to its owner, and leaves no file", async () => {
    const refused: OwnerOnly = async () => {
      throw new Error("icacls: Access is denied.");
    };

    await expect(writeDevAccess(secrets, file, refused)).rejects.toThrow(/readable by you alone/);
    expect(existsSync(file)).toBe(false);
  });

  it("with no AWS session, fails naming aws sso login, and writes nothing", async () => {
    const expired: SecretReader = async () => {
      throw new Error("Error when retrieving token from sso: Token has expired and refresh failed");
    };

    const failed = writeDevAccess(expired, file, closes);

    await expect(failed).rejects.toThrow(/aws sso login/);
    expect(existsSync(file)).toBe(false);
  });
});
