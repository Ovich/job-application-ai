import { afterEach, describe, expect, it, vi } from "vitest";
import { type Provider, subjectAt } from "../../support/providers";

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
const { cookiesSetBy, signedInAs, signInThrough } = await import("../../support/sign-in");

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
   * D17 as amended on 2026-09-11 (ID72): Microsoft, and Microsoft alone, is trusted by
   * name. A trusted provider is one whose email attaches without a verified claim, and
   * Microsoft is the one provider that never sends that claim for a personal account:
   * Entra issues `email_verified` and `verified_primary_email` for directory users only,
   * so under the bare default a Hotmail or Outlook account arriving second was refused
   * every time, observed on localhost. LinkedIn joined it at ID105, on the same evidence
   * from the dev address: a real sign-in there was answered `account_not_linked`, so its
   * claim does not arrive truthy either. Google alone sends it and stays at the default;
   * `tests/lib/auth/linking.test.ts` proves both halves.
   */
  it("trusts Microsoft's and LinkedIn's email by name, and Google's not at all", async () => {
    expect((await auth.$context).trustedProviders).toEqual(["microsoft", "linkedin"]);
  });
});

/**
 * Deletion (US5, D8, seam A of SL4): the library's own, switched on in `lib/auth` and
 * reached through `auth.api.deleteUser` with the session's cookie, as the web app's
 * client reaches `delete-user` (ID65, ID70). What goes is the library's tables' rows
 * for that person: the user, every session, every provider link.
 *
 * Each person signs in through the whole round trip (`tests/support/sign-in.ts`), so
 * the session is one the library opened itself. What is read afterwards is the
 * library's answer, `getSession` and `listUserAccounts`, never a select on its tables:
 * a person is gone when the library no longer answers for them, and a link is gone
 * when coming back through a provider finds no user to attach to.
 */
describe("lib/auth, deleting the signed-in person (US5)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A person, verified at every door, signing in through `provider`. */
  const signIn = (provider: Provider, email: string) =>
    signInThrough(provider, {
      subject: subjectAt(provider, email),
      name: "Someone Seeking",
      email,
      emailVerified: true,
    });

  /** The headers a browser holding that sign-in's cookies would send. */
  const holding = (response: Response) => new Headers({ cookie: cookiesSetBy(response) });

  const deleted = { success: true, message: "User deleted" };

  it("deletes the person the session's cookie names, and that cookie then has no session", async () => {
    const signedIn = await signIn("google", "deleted-by-cookie@example.com");
    expect(await signedInAs(signedIn)).not.toBeNull();

    expect(await auth.api.deleteUser({ headers: holding(signedIn), body: {} })).toEqual(deleted);

    expect(await auth.api.getSession({ headers: holding(signedIn) })).toBeNull();
  });

  it("ends the person's other sessions with it", async () => {
    const email = "deleted-with-two-sessions@example.com";
    const laptop = await signIn("google", email);
    const phone = await signIn("google", email);
    expect((await signedInAs(phone))?.id).toBe((await signedInAs(laptop))?.id);

    await auth.api.deleteUser({ headers: holding(laptop), body: {} });

    expect(await auth.api.getSession({ headers: holding(phone) })).toBeNull();
  });

  /**
   * ID90: deletion needs only a signed-in session. At the library's default a session
   * older than a day is not "fresh" and the deletion is refused; `freshAge: 0` turns
   * that check off. The session is opened two days back, and the session itself lives
   * seven, so it still answers when the deletion is asked for at the real time.
   */
  it("deletes from a session opened two days earlier all the same", async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(twoDaysAgo);
    const signedIn = await signIn("google", "deleted-two-days-on@example.com");
    vi.useRealTimers();
    expect(await signedInAs(signedIn)).not.toBeNull();

    expect(await auth.api.deleteUser({ headers: holding(signedIn), body: {} })).toEqual(deleted);

    expect(await auth.api.getSession({ headers: holding(signedIn) })).toBeNull();
  });

  /**
   * Signing in again with the same provider makes a new, empty user (US5). The links
   * went with the user: had Google's stayed, it would still name the old id, and had
   * Microsoft's, the person would come back as the user that was deleted.
   */
  it("makes a new user with that one link when the person comes back through a provider they had linked", async () => {
    const email = "deleted-then-back@example.com";
    await signIn("google", email);
    const linked = await signIn("microsoft", email);
    const before = await signedInAs(linked);
    expect(before).not.toBeNull();

    await auth.api.deleteUser({ headers: holding(linked), body: {} });
    const back = await signIn("microsoft", email);

    const after = await signedInAs(back);
    expect(after).not.toBeNull();
    expect(after?.id).not.toBe(before?.id);
    const accounts = await auth.api.listUserAccounts({ headers: holding(back) });
    expect(accounts.map((account) => account.providerId)).toEqual(["microsoft"]);
  });

  /** US4: a deletion reaches only the person whose session asked for it. */
  it("deletes nobody without a session, and another person's session still answers them", async () => {
    const other = await signIn("linkedin", "not-deleted@example.com");
    const them = await signedInAs(other);
    expect(them).not.toBeNull();

    await expect(auth.api.deleteUser({ headers: new Headers(), body: {} })).rejects.toMatchObject({
      statusCode: 401,
    });
    const someoneElse = await signIn("google", "deleted-beside-another@example.com");
    await auth.api.deleteUser({ headers: holding(someoneElse), body: {} });

    expect((await auth.api.getSession({ headers: holding(other) }))?.user.id).toBe(them?.id);
  });
});
