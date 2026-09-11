import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../../env";
import { db } from "../db";

/**
 * The authentication library, configured. This module exposes `auth`, the Better Auth
 * instance, and nothing else (ID57): the providers, the adapter and every option are
 * its business alone, and a caller mounts `auth.handler` or asks `auth.api`.
 *
 * Nothing of the flow is written here or anywhere in this repository (board D2, D3):
 * the redirect, the `state`, the code exchange, the session and its cookie are the
 * library's, reached through its own routes. What this file decides is three things,
 * and every other option stays at the library's default (D20):
 *
 * - **Where the app is.** `baseURL` is where the browser reaches the app, and so the
 *   origin a provider sends it back to; the callback the person registers at each
 *   provider is `<baseURL>/api/auth/callback/<provider>`. It comes from `env.ts`,
 *   never read here.
 * - **Which database.** The Drizzle adapter over the API's own instance (`lib/db`),
 *   whose schema carries the library's tables as the library generated them (ID56):
 *   `user`, `session`, `account`, `verification`, under their standard names (D7).
 * - **Which providers.** All three at launch (D4): Google, Microsoft at the `common`
 *   tenant so a personal Hotmail or Outlook account signs in as a work one does, and
 *   LinkedIn under Sign In with LinkedIn using OpenID Connect, with the scopes the
 *   library asks for by default (`openid`, `profile`, `email`) and nothing added:
 *   LinkedIn is identity only (D10). The identity is the email (D11), which each
 *   supplies in those default scopes.
 *
 * Linking is the library's default, unconfigured (D17): a second provider attaches to
 * the existing user when the email matches and the provider says it verified it.
 * `trustedProviders` stays empty on purpose; a provider listed there attaches its
 * unverified email too, which is a bypass of that check and not a way to make linking
 * "more reliable". `tests/lib/auth/linking.test.ts` proves the default on this
 * database.
 *
 * The cloud runtime may lack a provider's client until S5.2 (see `env.ts`), and then
 * that provider is not configured: the routes still mount and answer, there is just no
 * button that leads anywhere, which is the state the deployed environment is in until
 * slice 5.
 *
 * This is also the file the schema generator reads (ID56b): `auth generate` imports
 * it to know which tables to emit, which is why the configuration exists before the
 * schema does.
 */

/** A provider's client, when both halves were given; nothing when either is missing. */
const clientOf = (clientId: string | undefined, clientSecret: string | undefined) =>
  clientId === undefined || clientSecret === undefined ? undefined : { clientId, clientSecret };

const google = clientOf(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
const microsoft = clientOf(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);
const linkedin = clientOf(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET);

export const auth = betterAuth({
  ...(env.APP_URL === undefined ? {} : { baseURL: env.APP_URL }),
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    ...(google === undefined ? {} : { google }),
    // `common` is the library's default too; written out because it is the decision
    // (D4), and `organizations` would turn personal accounts away at Microsoft's door.
    ...(microsoft === undefined ? {} : { microsoft: { ...microsoft, tenantId: "common" } }),
    ...(linkedin === undefined ? {} : { linkedin }),
  },
});
