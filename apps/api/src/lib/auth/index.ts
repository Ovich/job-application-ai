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
 * Linking is the library's (D17): a second provider attaches to the existing user when
 * the email matches and the provider says it verified it. A provider in
 * `trustedProviders` attaches its email without that claim, which is a bypass of the
 * check, so a name is added only on evidence that the provider refuses to link
 * otherwise, and every name costs the same thing: whoever could hold an account there
 * on that address could reach this user.
 *
 * Microsoft (ID72, the person's amendment of 2026-09-11): Entra never issues
 * `email_verified` or `verified_primary_email` for a personal Microsoft account, so
 * under the bare default every Hotmail or Outlook user arriving second was refused, as
 * observed on localhost. Microsoft verifies the address when the account is created,
 * which is what the claim would have said.
 *
 * LinkedIn (ID105, the person's amendment of 2026-09-12): the same refusal, seen a day
 * later on the dev address rather than on a laptop. A real LinkedIn sign-in whose
 * address already belonged to a Google user was answered `account_not_linked`, so its
 * claim does not arrive truthy either. LinkedIn requires confirming an email at signup,
 * which is what makes this the same trade.
 *
 * Trusting a provider by name is only half of what that trust means, and ID106 (the
 * person's amendment of 2026-09-12) is the other half. `trustedProviders` is read when
 * a provider arrives SECOND; it says nothing about the row a provider writes when it
 * arrives first. That row records the address unverified, because the claim the
 * provider does not send is the very reason it is trusted, and the library's linking
 * check has a second gate that reads it: before it attaches anything it asks that the
 * local row be verified (`requireLocalEmailVerified`, on by its default, and a gate the
 * library is making unconditional in its next minor). So on the dev address a hotmail
 * account that had signed in through Microsoft turned LinkedIn away with
 * `account_not_linked` even with both names trusted, and the refusal was never
 * LinkedIn's claim but ours. `mapProfileToUser` below writes into the row what the two
 * amendments above already decided: the address these providers return is verified at
 * the provider. It costs nothing the names did not already cost.
 *
 * Google alone stays at the default, unmapped and untrusted: it sends the claim, so the
 * row it writes is only ever what Google said. `tests/lib/auth/linking.test.ts` proves
 * every half on this database, and asks the refusal of Google, the one not trusted.
 *
 * Deletion is the library's too (D8, ID65): its `deleteUser` feature, switched on as it
 * documents, serves `delete-user` under the mount `app.ts` already has, and the web app
 * calls it through the library's client (ID70). That is using the library, not
 * overriding it (ID65c). It erases the user, every session and every provider link, and
 * clears the cookie. `sendDeleteAccountVerification` stays off, because deletion is
 * immediate and this product sends no email; `afterDelete` stays off, because work done
 * after the user row is gone cannot be rolled back with it (ID65b). What this product
 * owns beyond those tables goes in `beforeDelete`, below.
 *
 * The three providers are configured unconditionally, wherever this runs. Until S5.2 the
 * cloud could lack a client and mounted without that provider; `env.ts` now requires
 * every value in both branches, so there is nothing left to tolerate and the helpers
 * that tolerated it are gone (ID60). A value that is missing fails the cold start with
 * the field named, which is where a half-configured environment has to be found out.
 *
 * The secret is the fourth thing this file decides, and the one that is easiest to get
 * silently wrong (ID71): `secret` is passed in from `env.ts` rather than left to the
 * library, which would otherwise read `BETTER_AUTH_SECRET` from the process environment
 * itself (1.7.4, `create-context`) — a second reader behind the boundary `env.ts` holds,
 * with the value right and the boundary wrong. Omitted entirely, the library signs every
 * session cookie with its own public default and merely warns, unless `NODE_ENV` is
 * `production`, which the deployed function does not set.
 *
 * This is also the file the schema generator reads (ID56b): `auth generate` imports
 * it to know which tables to emit, which is why the configuration exists before the
 * schema does.
 */

/**
 * Everything this product owns beyond the library's tables, erased before the library
 * removes the user (ID65b). Empty in this slot, because nothing beyond those tables
 * exists yet (ID66). Each later slot extends this one function rather than inventing a
 * deletion path of its own:
 *
 * - the profile, its items, their metas and their provenance, with the profile's slot
 * - every S3 object belonging to the person, with the first slot that stores one
 * - the credit balance, with `credits-billing`
 * - the membership, with `credits-billing`: stopped at the payment provider here, so no
 *   renewal is ever charged to a person who no longer exists
 *
 * A failure in anything put here throws, and is never caught: a hook that failed quietly
 * would let the library remove the user over data that survived, the one outcome D8
 * cannot tolerate. The library runs the hook and its own deletes in no transaction
 * (SL4's F4), which the first slot to put work here has to answer.
 */
const beforeDelete = async (): Promise<void> => {};

/**
 * What a provider trusted by name says about its address, for the row this application
 * writes: verified. See ID106 in the note above. Only the two providers named there are
 * mapped, and the mapping says nothing else about the person.
 */
const verifiedAtTheProvider = () => ({ emailVerified: true });

export const auth = betterAuth({
  baseURL: env.APP_URL,
  // Configuration, never the library's own reading of the environment (ID71, and the
  // note above). Every session cookie this instance issues is signed with it.
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      // `common` is the library's default too; written out because it is the decision
      // (D4), and `organizations` would turn personal accounts away at Microsoft's door.
      tenantId: "common",
      // The trust of ID72, written into the row this provider creates: ID106.
      mapProfileToUser: verifiedAtTheProvider,
    },
    linkedin: {
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      // The trust of ID105, the same way: ID106.
      mapProfileToUser: verifiedAtTheProvider,
    },
  },
  // Off its default (D20), see the note above: ID72, then ID105.
  account: { accountLinking: { trustedProviders: ["microsoft", "linkedin"] } },
  user: { deleteUser: { enabled: true, beforeDelete } },
  // A stated departure from D20 (ID90): deletion needs only a signed-in session. At the
  // default, a session older than a day is not "fresh" and `delete-user` refuses it,
  // which a person signed in with a provider has no password to answer. 0 turns the
  // check off, as the library documents; no other endpoint this product uses asks for a
  // fresh session. The gate's typed code and its warning guard against a mistaken delete.
  session: { freshAge: 0 },
});
