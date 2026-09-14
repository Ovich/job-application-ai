import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * `pnpm dev:access`: dev's access, written into a git-ignored local file (ID222).
 *
 * The deployed end-to-end run and `pnpm dev:sql` need dev's database connection string
 * and the secret its function signs session cookies with. Both live in Secrets Manager;
 * this reads them with the person's own AWS login and writes `.env.deployed` at the
 * repository's root, which `e2e/support/config` reads after the environment. No
 * long-lived token: the file holds what the pipeline already reads, and the login that
 * fetched it expires on its own.
 *
 * Nothing it reads is ever printed. It refuses to write a file git would track, since a
 * secret in a tracked file is a committed secret one `git add .` away.
 */

/** One read of one secret's string, by id. The AWS CLI in production, a stand-in in tests. */
export type SecretReader = (id: string) => Promise<string>;

const theFile = ".env.deployed";
const databaseSecret = "jobapp/dev/database-url";
const authSecret = "jobapp/dev/auth";

const run = promisify(execFile);

/** Whether git ignores `.env.deployed` under `root`. Outside a repository, it does not. */
const ignored = async (root: string): Promise<boolean> => {
  try {
    await run("git", ["check-ignore", "--quiet", theFile], { cwd: root });
    return true;
  } catch {
    return false;
  }
};

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
    throw new Error(`${name} holds a quote or a line break, which .env.deployed cannot carry`);
  }
  return `${name}='${value}'`;
};

/** Reads both secrets and writes `.env.deployed` under `root`, or writes nothing. */
export const writeDevAccess = async (read: SecretReader, root: string): Promise<void> => {
  const databaseUrl = await readOrExplain(read, databaseSecret);
  const auth = JSON.parse(await readOrExplain(read, authSecret)) as { betterAuthSecret?: unknown };
  if (typeof auth.betterAuthSecret !== "string" || auth.betterAuthSecret === "") {
    throw new Error(`${authSecret} holds no betterAuthSecret`);
  }
  if (!(await ignored(root))) {
    throw new Error(`${theFile} is not ignored by git under ${root}: nothing written`);
  }
  const lines = [
    "# Dev's access, written by pnpm dev:access from Secrets Manager. Never commit it.",
    quoted("DEPLOYED_DATABASE_URL", databaseUrl),
    quoted("DEPLOYED_BETTER_AUTH_SECRET", auth.betterAuthSecret),
  ];
  await writeFile(join(root, theFile), `${lines.join("\n")}\n`, { mode: 0o600 });
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
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    await writeDevAccess(awsCli, root);
    console.log(
      `${theFile} written: DEPLOYED_DATABASE_URL and DEPLOYED_BETTER_AUTH_SECRET, values not shown`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "pnpm dev:access failed");
    process.exitCode = 1;
  }
}
