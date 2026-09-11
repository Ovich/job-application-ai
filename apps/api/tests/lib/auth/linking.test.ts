import { account, user } from "@app/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One email is one person (US2, D17), whichever button they pressed.
 *
 * Nothing in this repository links accounts: the library does, at its default, and
 * this file proves that the default behaves as the board decided, on this database,
 * with these providers. A second provider whose verified email matches an existing
 * user attaches to that user, one `account` row more and no `user` row more; the same
 * email arriving unverified does not attach, because a provider that has not checked
 * an address is not a witness to who owns it. That refusal is what `trustedProviders`
 * would switch off, which is why it stays empty (the slice's "watch out").
 *
 * The whole round trip runs, through the library's own routes and against a real
 * PostgreSQL (`tests/support/database.ts`): the sign-in that stores its `state`, then
 * the callback that redeems it, exchanges the code, reads the profile, and links or
 * refuses. Only the providers are stood in for, at the two addresses the callback
 * reaches out to; no code here reproduces a step of the flow, and the assertions read
 * the tables the library wrote.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { testDb } = await import("../../support/database");
const { auth } = await import("../../../src/lib/auth");

/** Where the browser reaches the app, and so where a provider sends it back to. */
const appUrl = "http://localhost:4200";

type Provider = "google" | "microsoft" | "linkedin";

/** What a provider says about the person who just signed in at its door. */
type Identity = { subject: string; name: string; email: string; emailVerified: boolean };

/**
 * An id token as a provider would mint it, decoded by the library and never verified
 * here: the callback trusts what the code exchange returned, because it made that
 * request itself to an address it chose, and the exchange is the thing stood in for.
 */
const idTokenFor = (claims: Record<string, unknown>) =>
  `${[{ alg: "none", typ: "JWT" }, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".")}.stood-in-for`;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const tokens = (extra: Record<string, unknown> = {}) => ({
  access_token: "stood-in-for-access-token",
  token_type: "Bearer",
  expires_in: 3600,
  ...extra,
});

/**
 * Each provider at its doors: the token endpoint the callback exchanges the code at,
 * and wherever the profile comes from. Google and Microsoft put it in the id token
 * (Microsoft under `oid`, and the callback also asks Graph for a photo, which is
 * answered "none"); LinkedIn answers a userinfo request. The verified flag travels the
 * way each provider carries it.
 */
const doorsOf: Record<Provider, (who: Identity) => Record<string, () => Response>> = {
  google: (who) => ({
    "https://oauth2.googleapis.com/token": () =>
      json(
        tokens({
          scope: "openid email profile",
          id_token: idTokenFor({
            sub: who.subject,
            name: who.name,
            email: who.email,
            email_verified: who.emailVerified,
          }),
        }),
      ),
  }),
  microsoft: (who) => ({
    "https://login.microsoftonline.com/common/oauth2/v2.0/token": () =>
      json(
        tokens({
          scope: "openid profile email User.Read",
          id_token: idTokenFor({
            oid: who.subject,
            tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
            name: who.name,
            email: who.email,
            email_verified: who.emailVerified,
          }),
        }),
      ),
    "https://graph.microsoft.com/v1.0/me/photos/48x48/$value": () =>
      new Response(null, { status: 404 }),
  }),
  linkedin: (who) => ({
    "https://www.linkedin.com/oauth/v2/accessToken": () =>
      json(tokens({ scope: "openid profile email" })),
    "https://api.linkedin.com/v2/userinfo": () =>
      json({
        sub: who.subject,
        name: who.name,
        email: who.email,
        email_verified: who.emailVerified,
      }),
  }),
};

/** The network, answering at the doors given and nowhere else. */
const standingInFor =
  (doors: Record<string, () => Response>) =>
  async (input: string | URL | Request): Promise<Response> => {
    const address = new URL(input instanceof Request ? input.url : input);
    const door = doors[`${address.origin}${address.pathname}`];
    if (door === undefined) throw new Error(`nothing stands in for ${address.href}`);
    return door();
  };

/** The cookies a response set, as the browser would send them back. */
const cookiesSetBy = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/**
 * The round trip: the press on the button, then the browser coming back from the
 * provider with a code. The `state` travels as the library sends it, in the address
 * it gave the browser and in the cookie it set.
 */
const signInThrough = async (provider: Provider, who: Identity): Promise<Response> => {
  const started = await auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ provider, callbackURL: "/" }),
    }),
  );
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";

  vi.stubGlobal("fetch", standingInFor(doorsOf[provider](who)));
  return auth.handler(
    new Request(`${appUrl}/api/auth/callback/${provider}?code=stood-in-for-code&state=${state}`, {
      headers: { cookie: cookiesSetBy(started) },
    }),
  );
};

/** Where the callback sent the browser. */
const landingOf = (response: Response) => new URL(response.headers.get("location") ?? "", appUrl);

/** Who the callback's cookies say is signed in: the library's own answer. */
const signedInAs = async (response: Response) => {
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookiesSetBy(response) }),
  });
  return session?.user ?? null;
};

const usersAt = (email: string) => testDb.select().from(user).where(eq(user.email, email));

const providersOf = async (userId: string) =>
  (
    await testDb
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId))
  )
    .map((row) => row.providerId)
    .sort();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("linking, at the library's default (D17)", () => {
  /** The second providers. Google is the first in every case, as it is in US2. */
  const arrivingSecond: Provider[] = ["microsoft", "linkedin"];

  it.each(arrivingSecond)(
    "%s, with the same verified email, attaches to the user Google created, and no second user is created",
    async (provider) => {
      // Each case owns an address, because the cases share the one database.
      const email = `verified-through-${provider}@example.com`;
      const who = { name: "Someone Seeking", email, emailVerified: true };

      const first = await signInThrough("google", { ...who, subject: "google-subject" });
      const created = await signedInAs(first);
      expect(created).not.toBeNull();

      const second = await signInThrough(provider, { ...who, subject: `${provider}-subject` });

      expect(landingOf(second).pathname).toBe("/");
      expect((await signedInAs(second))?.id).toBe(created?.id);
      expect(await usersAt(email)).toHaveLength(1);
      expect(await providersOf(created?.id ?? "")).toEqual(["google", provider].sort());
    },
  );

  it.each(arrivingSecond)(
    "%s, with the same email unverified, does not attach",
    async (provider) => {
      const email = `unverified-through-${provider}@example.com`;
      const who = { name: "Someone Seeking", email };

      const first = await signInThrough("google", {
        ...who,
        subject: "google-subject",
        emailVerified: true,
      });
      const created = await signedInAs(first);
      expect(created).not.toBeNull();

      const second = await signInThrough(provider, {
        ...who,
        subject: `${provider}-subject`,
        emailVerified: false,
      });

      // The library's refusal, by name, and no session behind it.
      expect(landingOf(second).searchParams.get("error")).toBe("account_not_linked");
      expect(await signedInAs(second)).toBeNull();
      expect(await usersAt(email)).toHaveLength(1);
      expect(await providersOf(created?.id ?? "")).toEqual(["google"]);
    },
  );
});
