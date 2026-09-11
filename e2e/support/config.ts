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
 * So this file is exempted by name, and it is the only one: the deploy workflow reads
 * `jobapp/dev/auth` and the connection string it already reads for the migration, masks
 * both, and hands them to the check step. A run that asks for them without them being
 * set fails saying which one is missing, rather than failing later as a session that is
 * never accepted — which is what an empty secret looks like from the browser's side.
 */

/** What the deployed fixture needs to sign a person in against the deployed address. */
export type DeployedSecrets = {
  /** Neon's pooled connection string, the one the function and the migration use. */
  readonly databaseUrl: string;
  /** What the deployed function signs and verifies its session cookies with (ID71). */
  readonly authSecret: string;
};

const required = (name: string): string => {
  // The rule's own advice is a centralised configuration file, and this file is it: the
  // end-to-end tree's one reader of the environment, exempted by name (ID102).
  // biome-ignore lint/style/noProcessEnv: see above
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: the deployed end-to-end run is given it by the deploy workflow, masked, from Secrets Manager. Run this project with pnpm test:e2e:deployed from the pipeline, or export it yourself to run it by hand.`,
    );
  }
  return value;
};

/**
 * Read when a spec asks, never at import: the `local` project collects some of the same
 * specs and has no business failing because a deployed secret is not in its environment.
 */
export const deployedSecrets = (): DeployedSecrets => ({
  databaseUrl: required("DEPLOYED_DATABASE_URL"),
  authSecret: required("DEPLOYED_BETTER_AUTH_SECRET"),
});
