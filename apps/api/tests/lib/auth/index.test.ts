import { describe, expect, it, vi } from "vitest";

/**
 * The library's instance, at its interface (ID57): `auth`, configured, and nothing
 * else. What is asked of it here is what the configuration decides and nothing the
 * library does on its own: that there is no session without a cookie, and that a
 * sign-in goes to Google carrying the client this API was given and the address it
 * wants the browser sent back to.
 *
 * The second is the one that matters on the day the person registers the client app:
 * the `redirect_uri` below is the URI Google must be told, character for character,
 * and a port's difference is a `redirect_uri_mismatch` at Google's door rather than
 * an error here. Holding it in a test keeps it from moving without anyone noticing.
 *
 * The database is a real PostgreSQL in this process, built from the project's own
 * migrations (`tests/support/database.ts`): a sign-in stores its `state` in the
 * library's `verification` table before it answers, so a schema that does not carry
 * the library's tables fails here rather than at the first press of the button.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { env } = await import("../../../src/env");
const { auth } = await import("../../../src/lib/auth");

describe("lib/auth", () => {
  it("has no session to answer when no cookie is presented", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });

  it("sends a sign-in to Google, to come back to the app's own address", async () => {
    const answer = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: "/" },
    });

    expect(answer.redirect).toBe(true);
    const sendingTo = new URL(answer.url ?? "");
    expect(sendingTo.origin).toBe("https://accounts.google.com");
    expect(sendingTo.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    // The one string that has to agree with the registration at Google.
    expect(sendingTo.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4200/api/auth/callback/google",
    );
    // D11: the identity is the email, so it is a claim the sign-in asks for.
    expect(sendingTo.searchParams.get("scope")).toContain("email");
  });

  /**
   * D4: Microsoft at the `common` tenant, which is the endpoint that admits a personal
   * Hotmail or Outlook account as well as a work one. `organizations` would turn the
   * personal ones away at Microsoft's door, and the path below is where that shows.
   */
  it("sends a sign-in to Microsoft's common tenant, to come back to the app's own address", async () => {
    const answer = await auth.api.signInSocial({
      body: { provider: "microsoft", callbackURL: "/" },
    });

    expect(answer.redirect).toBe(true);
    const sendingTo = new URL(answer.url ?? "");
    expect(sendingTo.origin).toBe("https://login.microsoftonline.com");
    expect(sendingTo.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(sendingTo.searchParams.get("client_id")).toBe(env.MICROSOFT_CLIENT_ID);
    // The one string that has to agree with the registration in Microsoft Entra.
    expect(sendingTo.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4200/api/auth/callback/microsoft",
    );
    expect(sendingTo.searchParams.get("scope")).toContain("email");
  });

  /**
   * D10: LinkedIn is identity only. The scopes are the three the library asks for by
   * default under Sign In with LinkedIn using OpenID Connect, and nothing is added to
   * them; a fourth here is a product the person did not activate and a consent screen
   * they did not agree to.
   */
  it("sends a sign-in to LinkedIn asking for the OpenID Connect scopes and nothing more", async () => {
    const answer = await auth.api.signInSocial({
      body: { provider: "linkedin", callbackURL: "/" },
    });

    expect(answer.redirect).toBe(true);
    const sendingTo = new URL(answer.url ?? "");
    expect(sendingTo.origin).toBe("https://www.linkedin.com");
    expect(sendingTo.searchParams.get("client_id")).toBe(env.LINKEDIN_CLIENT_ID);
    // The one string that has to agree with the registration at LinkedIn.
    expect(sendingTo.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4200/api/auth/callback/linkedin",
    );
    expect(sendingTo.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
  });

  /**
   * D17, D20: linking is the library's default and nothing here configures it. No
   * provider is trusted by name, because a trusted provider is one whose unverified
   * email attaches all the same; the check `tests/lib/auth/linking.test.ts` proves
   * depends on this list staying empty.
   */
  it("leaves linking at the library's defaults, with no provider trusted by name", async () => {
    expect(auth.options).not.toHaveProperty("account");
    expect((await auth.$context).trustedProviders).toEqual([]);
  });
});
