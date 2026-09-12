import { account, user } from "@app/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Provider, subjectAt } from "../../support/providers";

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
 * The whole round trip runs (`tests/support/sign-in.ts`), through the library's own
 * routes and against a real PostgreSQL (`tests/support/database.ts`), with the
 * providers stood in for at their doors (`tests/support/providers.ts`). The assertions
 * read the library's answer through its routes, and the tables it wrote.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { testDb } = await import("../../support/database");
const { landingOf, signedInAs, signInThrough } = await import("../../support/sign-in");

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

      const first = await signInThrough("google", { ...who, subject: subjectAt("google", email) });
      const created = await signedInAs(first);
      expect(created).not.toBeNull();

      const second = await signInThrough(provider, { ...who, subject: subjectAt(provider, email) });

      expect(second.status).toBe(302);
      expect(landingOf(second).pathname).toBe("/");
      expect((await signedInAs(second))?.id).toBe(created?.id);
      expect(await usersAt(email)).toHaveLength(1);
      expect(await providersOf(created?.id ?? "")).toEqual(["google", provider].sort());
    },
  );

  /**
   * The refusal is still the default and still has to be proved, so it is asked of the
   * one provider that is not trusted by name. Google was the second provider here
   * because ID105 made LinkedIn the first: a case that refuses through a trusted
   * provider would prove nothing about the check, only about the bypass.
   */
  it("Google, with the same email and no verified claim, does not attach", async () => {
    const email = "unverified-through-google@example.com";
    const who = { name: "Someone Seeking", email };

    const first = await signInThrough("linkedin", {
      ...who,
      subject: subjectAt("linkedin", email),
      emailVerified: true,
    });
    const created = await signedInAs(first);
    expect(created).not.toBeNull();

    const second = await signInThrough("google", {
      ...who,
      subject: subjectAt("google", email),
      emailVerified: false,
    });

    // The library's refusal, by name, and no session behind it.
    expect(second.status).toBe(302);
    expect(landingOf(second).searchParams.get("error")).toBe("account_not_linked");
    expect(await signedInAs(second)).toBeNull();
    expect(await usersAt(email)).toHaveLength(1);
    expect(await providersOf(created?.id ?? "")).toEqual(["linkedin"]);
  });

  /**
   * D17 as amended twice. ID72: a personal Microsoft account never carries a
   * verified-email claim, so Microsoft is trusted by name and its email attaches without
   * one — the case refused on localhost on 2026-09-11, a hotmail address arriving after
   * LinkedIn. ID105: LinkedIn joins it, on the same evidence seen a day later on the dev
   * address, where a real LinkedIn sign-in was answered `account_not_linked` because its
   * claim did not arrive truthy either. Google alone stays at the default.
   */
  const trustedByName: Provider[] = ["microsoft", "linkedin"];

  it.each(trustedByName)(
    "%s, with the same email and no verified claim, attaches all the same",
    async (provider) => {
      const email = `unverified-through-${provider}@example.com`;
      const who = { name: "Someone Seeking", email };

      const first = await signInThrough("google", {
        ...who,
        subject: subjectAt("google", email),
        emailVerified: true,
      });
      const created = await signedInAs(first);
      expect(created).not.toBeNull();

      const second = await signInThrough(provider, {
        ...who,
        subject: subjectAt(provider, email),
        emailVerified: false,
      });

      expect(second.status).toBe(302);
      expect(landingOf(second).pathname).toBe("/");
      expect((await signedInAs(second))?.id).toBe(created?.id);
      expect(await usersAt(email)).toHaveLength(1);
      expect(await providersOf(created?.id ?? "")).toEqual(["google", provider].sort());
    },
  );
});
