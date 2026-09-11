import { vi } from "vitest";

/**
 * The three providers, stood in for at their doors.
 *
 * No test reaches a real provider, and none should: what a provider says about the
 * person at its door is decided per case, as an `Identity`, and what the library does
 * with that answer is what a test observes. A callback reaches out to the network at
 * two addresses at most, the token endpoint it exchanges the code at and wherever the
 * profile comes from, and those are the doors answered here. Nothing of the flow is
 * reproduced: the sign-in, the `state`, the callback and the linking stay the
 * library's, driven through its routes by `tests/support/sign-in.ts`.
 */

export type Provider = "google" | "microsoft" | "linkedin";

/** What a provider says about the person who just signed in at its door. */
export type Identity = { subject: string; name: string; email: string; emailVerified: boolean };

/**
 * The provider's own id for that person, one per address: an account is keyed on it,
 * and a subject seen before signs in as the user it belongs to, whatever address it
 * carries this time. A case that means a different person gives a different address,
 * and so a different subject.
 */
export const subjectAt = (provider: Provider, email: string) => `${provider}:${email}`;

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
export const doorsOf: Record<Provider, (who: Identity) => Record<string, () => Response>> = {
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
export const standingInFor =
  (doors: Record<string, () => Response>) =>
  async (input: string | URL | Request): Promise<Response> => {
    const address = new URL(input instanceof Request ? input.url : input);
    // Decoded, so a door is written the way its documentation writes it (`$value`).
    const door = doors[`${address.origin}${decodeURIComponent(address.pathname)}`];
    if (door === undefined) throw new Error(`nothing stands in for ${address.href}`);
    return door();
  };

/**
 * Puts one provider's doors on the network, in place of the platform's `fetch`, until
 * the test file's `afterEach` takes them off again (`vi.unstubAllGlobals`). The
 * library's fetches go to the global at call time, so a stand-in installed between the
 * sign-in and the callback is the one the callback meets.
 */
export const standIn = (provider: Provider, who: Identity): void => {
  vi.stubGlobal("fetch", standingInFor(doorsOf[provider](who)));
};
