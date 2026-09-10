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
vi.mock("../../../src/lib/db", async () => ({ db: (await import("../../support/database")).testDb }));

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
});
