import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * (ID222). The deploy workflow reads `jobapp/dev/auth` and the connection string it
 * already reads for the migration, masks both, and hands them to the check step in the
 * environment. On a laptop, `pnpm dev:access` writes them into `.env.deployed` at the
 * repository's root, which git ignores, with the person's own AWS login. The environment
 * is read first, so the workflow's run is the same whether or not a file is there.
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

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** What `.env.deployed` holds under `root`, or nothing when there is no such file. */
const theFile = (root: string): Record<string, string | undefined> => {
  const path = join(root, ".env.deployed");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
};

/**
 * Read when a spec asks, never at import: the `local` project collects some of the same
 * specs and has no business failing because a deployed secret is not in its environment.
 * `root` is the repository's; a test points it at a directory of its own.
 */
export const deployedSecrets = (root: string = repositoryRoot): DeployedSecrets => {
  const file = theFile(root);
  const required = (name: string): string => {
    const value = process.env[name] || file[name];
    if (value === undefined || value === "") {
      throw new Error(
        `${name} is not set. On a laptop, run pnpm dev:access to write it into .env.deployed from Secrets Manager with your AWS login; in the pipeline, the deploy workflow hands it to pnpm test:e2e:deployed, masked.`,
      );
    }
    return value;
  };
  return {
    databaseUrl: required("DEPLOYED_DATABASE_URL"),
    authSecret: required("DEPLOYED_BETTER_AUTH_SECRET"),
  };
};
