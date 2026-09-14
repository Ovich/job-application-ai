import { execFile } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

/**
 * `pnpm dev:access`: dev's access, written into one file in the person's profile (ID222,
 * ID231).
 *
 * The deployed end-to-end run, `pnpm dev:sql` and any Postgres tool need dev's database
 * connection and the secret its function signs session cookies with. Both live in Secrets
 * Manager; this reads them with the person's own AWS login and writes
 * `%USERPROFILE%\.jobapp\dev.env` (`~/.jobapp/dev.env` elsewhere), which
 * `e2e/support/config` reads after the environment. One file outside every checkout, so
 * every worktree and agent reads the same one and no checkout can commit it. No long-lived
 * token: the file holds what the pipeline already reads, and the login that fetched it
 * expires on its own.
 *
 * The file is readable by the person alone, because a file in a `C:\JOBAPP-*` checkout
 * inherits `Authenticated Users: Modify`: it is closed to its owner while still empty, and
 * only then are the values written. When it cannot be closed, the command fails and leaves
 * no file. Nothing it reads is ever printed.
 */

/** One read of one secret's string, by id. The AWS CLI in production, a stand-in in tests. */
export type SecretReader = (id: string) => Promise<string>;

/** Leaves `file` readable and writable by the current user alone, or throws. */
export type OwnerOnly = (file: string) => Promise<void>;

const databaseSecret = "jobapp/dev/database-url";
const authSecret = "jobapp/dev/auth";

const run = promisify(execFile);

const readOrExplain = async (read: SecretReader, id: string): Promise<string> => {
  try {
    return await read(id);
  } catch (error) {
    throw new Error(
      `could not read ${id} from Secrets Manager. Is your AWS login live? Run aws sso login, then pnpm dev:access again.`,
      { cause: error },
    );
  }
};

/** A value quoted so `parseEnv` gives it back as it is. */
const quoted = (name: string, value: string): string => {
  if (value.includes("'") || value.includes("\n")) {
    throw new Error(`${name} holds a quote or a line break, which dev.env cannot carry`);
  }
  return `${name}='${value}'`;
};

/**
 * The connection string split into the variables `psql` and libpq read, so a Postgres tool
 * connects with no argument. A parse error never carries the string itself.
 */
const libpq = (url: string): [string, string][] => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${databaseSecret} is not a connection URL`);
  }
  return [
    ["PGHOST", parsed.hostname],
    ["PGPORT", parsed.port || "5432"],
    ["PGDATABASE", decodeURIComponent(parsed.pathname.slice(1))],
    ["PGUSER", decodeURIComponent(parsed.username)],
    ["PGPASSWORD", decodeURIComponent(parsed.password)],
    // Neon refuses a connection without TLS, so a string that does not say is still TLS.
    ["PGSSLMODE", parsed.searchParams.get("sslmode") ?? "require"],
  ];
};

/** Reads both secrets and writes `file`, closed to its owner, or leaves no file. */
export const writeDevAccess = async (
  read: SecretReader,
  file: string,
  ownerOnly: OwnerOnly,
): Promise<void> => {
  const databaseUrl = await readOrExplain(read, databaseSecret);
  const auth = JSON.parse(await readOrExplain(read, authSecret)) as { betterAuthSecret?: unknown };
  if (typeof auth.betterAuthSecret !== "string" || auth.betterAuthSecret === "") {
    throw new Error(`${authSecret} holds no betterAuthSecret`);
  }
  const lines = [
    "# Dev's access, written by pnpm dev:access from Secrets Manager. Never share or commit it.",
    quoted("DEPLOYED_DATABASE_URL", databaseUrl),
    quoted("DEPLOYED_BETTER_AUTH_SECRET", auth.betterAuthSecret),
    ...libpq(databaseUrl).map(([name, value]) => quoted(name, value)),
  ];

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "", { mode: 0o600 });
  try {
    await ownerOnly(file);
  } catch (error) {
    await rm(file, { force: true });
    throw new Error(`${file} could not be made readable by you alone: nothing written`, {
      cause: error,
    });
  }
  await writeFile(file, `${lines.join("\n")}\n`);
};

/**
 * On Windows, the file's rights reset to what it inherits, the inherited ones removed, and
 * the current user alone granted full control; `icacls` fails the command when it cannot.
 * Elsewhere, mode `0600`.
 */
const ownerOnly: OwnerOnly = async (file) => {
  if (process.platform !== "win32") {
    await chmod(file, 0o600);
    return;
  }
  const me = (await run("whoami")).stdout.trim();
  await run("icacls", [file, "/reset"]);
  await run("icacls", [file, "/inheritance:r", "/grant:r", `${me}:F`]);
};

/**
 * The AWS CLI, as the deploy workflow reads the same two secrets. The region is the one
 * every stack but the certificate lives in.
 */
const awsCli: SecretReader = async (id) => {
  const { stdout } = await run("aws", [
    "secretsmanager",
    "get-secret-value",
    "--region",
    "eu-central-1",
    "--secret-id",
    id,
    "--query",
    "SecretString",
    "--output",
    "text",
  ]);
  return stdout.replace(/\r?\n$/, "");
};

if (import.meta.main) {
  // Imported by address with its extension, which Node's own TypeScript needs and the
  // compiler's resolution here does not allow in a static import; typed by the module.
  const { devAccessFile } = (await import(
    new URL("../e2e/support/config.ts", import.meta.url).href
  )) as typeof import("../e2e/support/config");
  const file = devAccessFile();
  try {
    await writeDevAccess(awsCli, file, ownerOnly);
    console.log(
      `${file} written, readable by you alone: DEPLOYED_DATABASE_URL, DEPLOYED_BETTER_AUTH_SECRET, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE; values not shown`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "pnpm dev:access failed");
    process.exitCode = 1;
  }
}
