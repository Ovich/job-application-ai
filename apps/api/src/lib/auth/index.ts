import {
  document,
  itemEducation,
  itemEntry,
  itemExperience,
  itemLine,
  itemProject,
  profileConcern,
  profileItem,
  question,
} from "@app/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import { db } from "../db";
import { keyFor, storage } from "../storage";

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
 * removes the user (ID65b, ID126). Each later slot extends this one function rather
 * than inventing a deletion path of its own:
 *
 * - the documents, the profile, its items, their lines and their per-kind rows, the rules
 *   and the questions — this slot's (`SL5`)
 * - every S3 object belonging to the person — this slot's too, and the reason the rows
 *   are erased here rather than left to the `on delete cascade` each of those tables
 *   already carries: a row deleted with its object left behind is a promise broken
 *   quietly, so the one call that takes the bytes is the one that takes the rows
 * - the credit balance, with `credits-billing`
 * - the membership, with `credits-billing`: stopped at the payment provider here, so no
 *   renewal is ever charged to a person who no longer exists
 *
 * **The objects go first, and the order is the decision** (`ID126`, and the plan's `F1`,
 * accepted by the person on 2026-09-12). `US11` asked for the erasure "in the same
 * transaction as the user row", which cannot be had: the library runs this hook and its
 * own deletes in no transaction (`SL4`'s `F4`), and nothing here has a handle on the one
 * it later uses. What is held instead is the call — the objects, then this product's own
 * tables in one transaction of its own, and nothing of the person surviving a call that
 * returned. Objects first means a failure leaves the person whole and the retry safe;
 * rows first would leave bytes no document row points at, unreachable by anyone.
 *
 * **A failure throws and is never caught**: a hook that failed quietly would let the
 * library remove the user over data that survived, the one outcome D8 cannot tolerate.
 * The library then leaves the user row alone and the web app shows the refusal it
 * already handles, so the person presses the button again — which is why this is
 * **idempotent**: every statement below is a delete of what is there, and running it a
 * second time on a person the first run half-erased finishes the job.
 *
 * The erasure lives here rather than in a module of its own because the plan's register
 * gives it none (the plan's `F2`); the day `credits-billing` adds the balance and the
 * membership to the same hook, a module earns its place and a register row with it.
 */
const beforeDelete = async (user: { id: string }): Promise<void> => {
  const documents = await db
    .select({ id: document.id, storageKey: document.storageKey })
    .from(document)
    .where(eq(document.userId, user.id));

  // The bytes, before any row goes. A key is composed the one way a key is ever
  // composed (`lib/storage`'s `keyFor`), and a document with no key — the typed
  // LinkedIn address, the one source that has no bytes — has no object to remove.
  for (const each of documents) {
    if (each.storageKey === null) continue;
    await storage.delete(keyFor(user.id, each.id));
  }

  await db.transaction(async (tx) => {
    const items = await tx
      .select({ id: profileItem.id })
      .from(profileItem)
      .where(eq(profileItem.userId, user.id));
    const itemIds = items.map((item) => item.id);

    // Ordered by the foreign keys and not by the register's sentence: the questions and
    // the profile concerns point at items, the lines at items, and every per-kind row at
    // the item it completes.
    await tx.delete(question).where(eq(question.userId, user.id));
    await tx.delete(profileConcern).where(eq(profileConcern.userId, user.id));
    if (itemIds.length > 0) {
      await tx.delete(itemLine).where(inArray(itemLine.itemId, itemIds));
      await tx.delete(itemExperience).where(inArray(itemExperience.itemId, itemIds));
      await tx.delete(itemProject).where(inArray(itemProject.itemId, itemIds));
      await tx.delete(itemEducation).where(inArray(itemEducation.itemId, itemIds));
      await tx.delete(itemEntry).where(inArray(itemEntry.itemId, itemIds));
    }
    await tx.delete(profileItem).where(eq(profileItem.userId, user.id));
    await tx.delete(document).where(eq(document.userId, user.id));
  });
};

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
