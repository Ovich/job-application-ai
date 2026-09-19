import { createHmac, randomUUID } from "node:crypto";
import * as schema from "@app/db";
import {
  document as documentRows,
  profileItem as profileItemRows,
  session as sessionRows,
  user as userRows,
} from "@app/db";
import type { APIResponse, Browser, BrowserContext } from "@playwright/test";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { payloadHashOf } from "./api";
import { deployedSecrets } from "./config";

/**
 * People signed in on browser contexts of their own (ID92, ID101).
 *
 * No test can drive a provider's own sign-in page — that is the person's check, once
 * per environment — so a person is signed in from the outside, and the two addresses
 * need two different outsides.
 *
 * **On a laptop**, the library's own `testUtils` plugin, in an instance of its own that
 * only this file builds, over the dev server's database. The library saves the person,
 * opens a session and answers the cookie in the shape a browser context takes; the dev
 * server reads it as it reads any other. Never `lib/auth`, whose configuration must
 * never carry the plugin, never a route of ours, and never a row written by hand.
 *
 * **Deployed**, the row is written by hand, and deliberately (ID101): the plugin would
 * need an instance pointed at the deployed database, and building one here is building
 * a second `lib/auth` in a test. So the fixture inserts the user and the session
 * through Drizzle with the generated `@app/db` schema — so the compiler checks them
 * against the schema the pipeline applies, and no hand-written second description of
 * those tables exists — and mints the cookie itself.
 *
 * The secret is needed whoever writes the row. The library sets its session cookie with
 * `setSignedCookie(name, token, secret)` (1.7.4), so what a browser presents is the
 * token, a dot, and an HMAC-SHA-256 of the token under the instance's secret, the whole
 * percent-encoded; a row inserted directly yields nothing the function will accept
 * without signing that value the same way. Deployed, that secret comes from
 * `support/config` (ID102); locally it is the committed throwaway `.env.example` fills
 * in, which is the same value the dev server verifies with (ID103) — the day those two
 * disagree, every isolation and deletion case goes red with a failure that reads like a
 * session bug and is a configuration one.
 *
 * The addresses are written here rather than read from the environment (ID29), as the
 * Playwright config writes its own.
 */

/** Which address a person is being signed in at: the Playwright project's own name. */
export type Where = "local" | "deployed";

export type Person = { name: string; email: string };

/** Where the browser reaches each app. The dev server forwards `/api` to the API. */
const appUrl: Record<Where, string> = {
  local: "http://localhost:4200",
  deployed: "https://dev.job-application.app",
};

/** The local database, as `docker-compose.yml` declares it. */
const database = {
  host: "localhost",
  port: 5432,
  database: "jobapp",
  username: "jobapp",
  password: "local_dev_only",
};

const where = `postgres://${database.username}@${database.host}:${database.port}/${database.database}`;

/**
 * What the dev server signs its session cookies with: the committed throwaway of
 * `apps/api/.env.example` (ID71, ID103). Not a secret, and the same literal on every
 * laptop, which is what lets a cookie minted here be accepted there.
 */
const localAuthSecret = "local_dev_only_not_a_real_secret_00000000";

/**
 * The local instance, opened on demand and reopened after `forget` lets it go, the way
 * the deployed database below already is.
 *
 * Opened once at module load it could not survive `forget`, and `forget` is what every
 * spec file calls in its `afterAll`: the files of a project share one worker process, so
 * the first file to finish ended the connection the rest were still going to sign people
 * in on, and each of them failed on its first insert with a message blaming the dev
 * server. It never showed on a laptop, where Playwright gives each file a worker of its
 * own; on CI, where the default is one worker, it took out every file but the first.
 */
const openLocal = () => {
  const connection = postgres({ ...database, max: 1, connect_timeout: 5 });
  const instance = betterAuth({
    baseURL: appUrl.local,
    secret: localAuthSecret,
    database: drizzleAdapter(drizzle(connection, { schema }), { provider: "pg" }),
    // Cast, and the helpers typed below by the library's own `TestHelpers`: the plugin's
    // declared `init` may answer `options: undefined`, which the plugin contract refuses
    // under this repository's `exactOptionalPropertyTypes`. The value is the library's.
    plugins: [testUtils() as BetterAuthPlugin],
  });
  return { connection, instance };
};

let local: ReturnType<typeof openLocal> | undefined;

/** The library's test helpers, which the plugin puts on the instance's context. */
const helpers = async (): Promise<TestHelpers> => {
  local ??= openLocal();
  return ((await local.instance.$context) as unknown as { test: TestHelpers }).test;
};

/** The ids of everyone this file saved, per address, so `forget` removes whoever is left. */
const made: Record<Where, string[]> = { local: [], deployed: [] };

/** The deployed database, opened once and only if a deployed spec asks for it. */
let deployedDatabase: ReturnType<typeof drizzle<typeof schema>> | undefined;
let deployedConnection: ReturnType<typeof postgres> | undefined;

const deployedDb = () => {
  if (deployedDatabase === undefined) {
    deployedConnection = postgres(deployedSecrets().databaseUrl, { max: 1, connect_timeout: 10 });
    deployedDatabase = drizzle(deployedConnection, { schema });
  }
  return deployedDatabase;
};

/**
 * The cookie value the library would have written: the token, a dot, the HMAC of the
 * token under the instance's secret, the whole percent-encoded (better-call's
 * `signCookieValue`, which better-auth's `setSignedCookie` calls).
 */
const signed = (token: string, secret: string): string =>
  encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);

/**
 * The cookie's name at each address. `__Secure-` is the library's own prefix whenever
 * its `baseURL` is https, so the deployed cookie carries it and the local one does not.
 */
const cookieName: Record<Where, string> = {
  local: "better-auth.session_token",
  deployed: "__Secure-better-auth.session_token",
};

/** A week, which is the library's own session length at its default. */
const aWeekOn = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** A person and an open session, written into the deployed database as the library would. */
const savedDeployed = async (who: Person): Promise<{ id: string; token: string }> => {
  const db = deployedDb();
  const id = randomUUID();
  const token = randomUUID().replaceAll("-", "");
  const now = new Date();
  await db
    .insert(userRows)
    .values({
      id,
      name: who.name,
      email: who.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .catch((error: unknown) => {
      throw new Error(
        `nothing answered on the deployed database: is DEPLOYED_DATABASE_URL the pooled string, and has the migration run? (${String(error)})`,
      );
    });
  await db.insert(sessionRows).values({
    id: randomUUID(),
    token,
    userId: id,
    expiresAt: aWeekOn(),
    createdAt: now,
    updatedAt: now,
  });
  return { id, token };
};

/** A new context carrying `who`'s session at that address. */
export const signedIn = async (
  browser: Browser,
  who: Person,
  at: Where = "local",
): Promise<BrowserContext> => {
  const context = await browser.newContext({ baseURL: appUrl[at] });
  if (at === "deployed") {
    const { id, token } = await savedDeployed(who);
    made.deployed.push(id);
    await context.addCookies([
      {
        name: cookieName.deployed,
        value: signed(token, deployedSecrets().authSecret),
        url: appUrl.deployed,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    return context;
  }

  const test = await helpers();
  const saved = await test
    .saveUser(test.createUser({ name: who.name, email: who.email, emailVerified: true }))
    .catch((error: unknown) => {
      throw new Error(
        `nothing answered on the local database at ${where}: is pnpm dev running? (${String(error)})`,
      );
    });
  made.local.push(saved.id);
  const { cookies } = await test.login({ userId: saved.id });
  await context.addCookies(cookies);
  return context;
};

/**
 * The person on `context` deletes their own account through the library's own route, as
 * the web app's client reaches it (`ID224`, `ID229`): the page's origin, which the library
 * demands of a request carrying a session cookie, and the payload hash the deployed origin
 * demands of a body. Through the app rather than the rows, so the objects a person uploaded
 * go with them. The answer is the caller's to judge.
 */
export const deletedThroughApp = async (
  context: BrowserContext,
  at: Where = "local",
): Promise<APIResponse> => {
  const body = "{}";
  return context.request.post("/api/auth/delete-user", {
    headers: {
      origin: new URL(appUrl[at]).origin,
      "content-type": "application/json",
      "x-amz-content-sha256": await payloadHashOf(body),
    },
    data: body,
  });
};

/**
 * What a reading leaves, written for `who` at that address (`ID212`): one document and one
 * profile item, so the profile assistant's opening finds a profile and a conversation can
 * be opened.
 *
 * The deployed suite cannot read a document (`ID138`), and the assistant opens only on a
 * person who has a profile (`ID202`, `ID334`), so the rows are written as the reading would
 * have written them. The document is a typed LinkedIn address, the one source with no storage
 * key, so deleting the account never reaches a bucket. Nothing is cleaned up here:
 * `forget` deletes the user, and the schema's cascade takes these rows with it.
 */
export const givenAReading = async (who: Person, at: Where = "local"): Promise<void> => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  if (at === "deployed") {
    db = deployedDb();
  } else {
    local ??= openLocal();
    db = drizzle(local.connection, { schema });
  }
  const [person] = await db
    .select({ id: userRows.id })
    .from(userRows)
    .where(eq(userRows.email, who.email));
  if (person === undefined) {
    throw new Error(`nobody is signed in as ${who.email} at the ${at} address to give a reading`);
  }
  const address = "https://www.linkedin.com/in/end-to-end";
  const documentId = randomUUID();
  await db.insert(documentRows).values({
    id: documentId,
    userId: person.id,
    filename: address,
    mediaType: "text/uri-list",
    source: "linkedin_address",
    address,
    status: "read",
    readAt: new Date(),
  });
  await db.insert(profileItemRows).values({
    id: randomUUID(),
    userId: person.id,
    kind: "summary",
    title: "Platform engineer",
    position: 1,
  });
};

/** Removes whoever this file made and the run did not delete, then lets the database go. */
export const forget = async (at: Where = "local"): Promise<void> => {
  if (at === "deployed") {
    const db = deployedDb();
    for (const id of made.deployed.splice(0)) {
      // The session rows go with the user: the schema cascades on delete.
      await db.delete(userRows).where(eq(userRows.id, id));
    }
    await deployedConnection?.end();
    deployedConnection = undefined;
    deployedDatabase = undefined;
    return;
  }
  const test = await helpers();
  for (const id of made.local.splice(0)) {
    await test.deleteUser(id);
  }
  await local?.connection.end();
  local = undefined;
};
