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
 *   origin a provider sends it back to; the callback the person registers at Google is
 *   `<baseURL>/api/auth/callback/google`. It comes from `env.ts`, never read here.
 * - **Which database.** The Drizzle adapter over the API's own instance (`lib/db`),
 *   whose schema carries the library's tables as the library generated them (ID56):
 *   `user`, `session`, `account`, `verification`, under their standard names (D7).
 * - **Which providers.** Google alone in this slice; Microsoft and LinkedIn join in
 *   SL2. The identity is the email (D11), which Google supplies in the scope the
 *   library asks for by default.
 *
 * The cloud runtime may lack a Google client until S5.2 (see `env.ts`), and then no
 * provider is configured: the routes still mount and answer, there is just no button
 * that leads anywhere, which is the state the deployed environment is in until slice 5.
 *
 * This is also the file the schema generator reads (ID56b): `auth generate` imports
 * it to know which tables to emit, which is why the configuration exists before the
 * schema does.
 */
export const auth = betterAuth({
  ...(env.APP_URL === undefined ? {} : { baseURL: env.APP_URL }),
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders:
    env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined
      ? {}
      : {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        },
});
