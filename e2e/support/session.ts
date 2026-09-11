import * as schema from "@app/db";
import type { Browser, BrowserContext } from "@playwright/test";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * People signed in on browser contexts of their own, for the local e2e (ID92).
 *
 * No test can drive a provider's sign-in page, so a person is signed in the one way the
 * library offers for tests: its `testUtils` plugin, in an instance of its own that only
 * this file builds, over the dev server's database. The library saves the person, opens
 * a session for them, and answers the cookie in the shape a browser context takes; the
 * dev server then reads that cookie as it reads any other. Never `lib/auth`, whose
 * configuration must never carry the plugin, never a route of ours, and never a row
 * written by hand.
 *
 * The addresses are written here rather than read from the environment (ID29), as the
 * Playwright config writes its own: the app's, and the local database's throwaway values
 * committed in `docker-compose.yml`. The cookie is signed with the library's default
 * secret, which is the one the dev server signs with too while `apps/api/.env` sets none
 * (ID71 decides the day that changes, and then this instance takes the same secret).
 */

/** Where the browser reaches the app: the dev server, which forwards `/api` to the API. */
const appUrl = "http://localhost:4200";

/** The local database, as `docker-compose.yml` declares it. */
const database = {
  host: "localhost",
  port: 5432,
  database: "jobapp",
  username: "jobapp",
  password: "local_dev_only",
};

const where = `postgres://${database.username}@${database.host}:${database.port}/${database.database}`;

export type Person = { name: string; email: string };

const connection = postgres({ ...database, max: 1, connect_timeout: 5 });

const instance = betterAuth({
  baseURL: appUrl,
  database: drizzleAdapter(drizzle(connection, { schema }), { provider: "pg" }),
  // Cast, and the helpers typed below by the library's own `TestHelpers`: the plugin's
  // declared `init` may answer `options: undefined`, which the plugin contract refuses
  // under this repository's `exactOptionalPropertyTypes`. The value is the library's.
  plugins: [testUtils() as BetterAuthPlugin],
});

/** The library's test helpers, which the plugin puts on the instance's context. */
const helpers = async (): Promise<TestHelpers> =>
  ((await instance.$context) as unknown as { test: TestHelpers }).test;

/** The ids of everyone this file saved, so `forget` can remove whoever is left. */
const made: string[] = [];

/** A new context carrying `who`'s session, saved and signed in by the library. */
export const signedIn = async (browser: Browser, who: Person): Promise<BrowserContext> => {
  const test = await helpers();
  const saved = await test
    .saveUser(test.createUser({ name: who.name, email: who.email, emailVerified: true }))
    .catch((error: unknown) => {
      throw new Error(
        `nothing answered on the local database at ${where}: is pnpm dev running? (${String(error)})`,
      );
    });
  made.push(saved.id);
  const { cookies } = await test.login({ userId: saved.id });
  const context = await browser.newContext({ baseURL: appUrl });
  await context.addCookies(cookies);
  return context;
};

/** Removes whoever this file made and the run did not delete, then lets the database go. */
export const forget = async (): Promise<void> => {
  const test = await helpers();
  for (const id of made.splice(0)) {
    await test.deleteUser(id);
  }
  await connection.end();
};
