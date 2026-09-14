import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

/**
 * The two values the deployed run cannot hold and cannot invent (ID102).
 *
 * Nothing in the end-to-end tree reads the environment: the addresses are written in
 * `playwright.config.ts` and the local database's throwaway credentials in
 * `support/session.ts`, because they are the same on every laptop and in every run
 * (ID29). Two values are not like that. The deployed database's connection string and
 * the secret the deployed function signs its session cookies with are secrets of one
 * environment, held in Secrets Manager, and a literal here would be a committed secret.
 *
 * So this file is exempted by name, and it is the only one. They reach it two ways
 * (ID222, ID231). The deploy workflow reads `jobapp/dev/auth` and the connection string it
 * already reads for the migration, masks both, and hands them to the check step in the
 * environment. On a laptop, `pnpm dev:access` writes them into `.jobapp/dev.env` in the
 * person's profile, readable by that person alone, with their own AWS login: one file
 * outside every checkout, so every worktree and agent reads the same one and no checkout
 * holds a secret. The environment is read first, so the workflow's run is the same
 * whether or not a file is there.
 *
 * A run that asks for them with neither fails saying where they come from, rather than
 * failing later as a session that is never accepted — which is what an empty secret
 * looks like from the browser's side.
 */

/** What the deployed fixture needs to sign a person in against the deployed address. */
export type DeployedSecrets = {
  /** Neon's pooled connection string, the one the function and the migration use. */
  readonly databaseUrl: string;
  /** What the deployed function signs and verifies its session cookies with (ID71). */
  readonly authSecret: string;
};

/**
 * Where `pnpm dev:access` writes dev's access: `%USERPROFILE%\.jobapp\dev.env` on Windows,
 * `~/.jobapp/dev.env` elsewhere. The home is read when asked, so a test can point it away.
 */
export const devAccessFile = (): string => join(homedir(), ".jobapp", "dev.env");

/** What the profile's `dev.env` holds, or nothing when there is no such file. */
const theFile = (): Record<string, string | undefined> => {
  const path = devAccessFile();
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
};

/**
 * Read when a spec asks, never at import: the `local` project collects some of the same
 * specs and has no business failing because a deployed secret is not in its environment.
 */
export const deployedSecrets = (): DeployedSecrets => {
  const file = theFile();
  const required = (name: string): string => {
    const value = process.env[name] || file[name];
    if (value === undefined || value === "") {
      throw new Error(
        `${name} is not set. On a laptop, run pnpm dev:access to write it into ${devAccessFile()} from Secrets Manager with your AWS login; in the pipeline, the deploy workflow hands it to pnpm test:e2e:deployed, masked.`,
      );
    }
    return value;
  };
  return {
    databaseUrl: required("DEPLOYED_DATABASE_URL"),
    authSecret: required("DEPLOYED_BETTER_AUTH_SECRET"),
  };
};
