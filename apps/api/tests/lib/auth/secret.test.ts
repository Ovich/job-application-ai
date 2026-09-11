import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { subjectAt } from "../../support/providers";

/**
 * What the library signs its session cookies with (ID71, seam B).
 *
 * Two halves of one decision, and the second is the one that can go wrong silently.
 * The instance signs with a value this project chose: a cookie it issued carries a
 * signature that verifies under `env.BETTER_AUTH_SECRET` and under nothing else. And
 * the instance is *given* that value rather than left to find it: absent the `secret`
 * option the library reads `process.env.BETTER_AUTH_SECRET` itself (1.7.4,
 * `create-context`), which would put a second reader of the process environment behind
 * the boundary `env.ts` holds — with the value right and the boundary wrong, which is
 * why no test that merely read the value could see it (F4).
 *
 * The second case is what separates the two: the environment is made to say one thing
 * and the configuration another, and the instance must hold the configuration's.
 *
 * The database is the in-process PostgreSQL the rest of this seam uses, because a
 * sign-in writes its `state` before it answers.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { env } = await import("../../../src/env");
const { signInThrough } = await import("../../support/sign-in");

/** The cookie the library sets a session under, at its default prefix and name. */
const sessionCookie = "better-auth.session_token";

/**
 * The two halves of a signed cookie's value, as better-call writes it: the value, a
 * dot, and the HMAC of the value, base64, the whole percent-encoded.
 */
const signedValueOf = (response: Response, name: string): [string, string] => {
  const cookie = response.headers
    .getSetCookie()
    .map((set) => set.split(";")[0] ?? "")
    .find((pair) => pair.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`no ${name} among the cookies that were set`);
  const decoded = decodeURIComponent(cookie.slice(name.length + 1));
  const dot = decoded.lastIndexOf(".");
  return [decoded.slice(0, dot), decoded.slice(dot + 1)];
};

/** The signature that secret would have produced over that value (better-call's crypto). */
const signatureUnder = (secret: string, value: string): string =>
  createHmac("sha256", secret).update(value).digest("base64");

describe("lib/auth, the secret it signs with (ID71)", () => {
  it("signs the session cookie with the secret the configuration read, and no other", async () => {
    const email = "signed-with-the-configured-secret@example.com";

    const signedIn = await signInThrough("google", {
      subject: subjectAt("google", email),
      name: "Someone Seeking",
      email,
      emailVerified: true,
    });

    const [token, signature] = signedValueOf(signedIn, sessionCookie);
    expect(signature).toBe(signatureUnder(env.BETTER_AUTH_SECRET, token));
    expect(signature).not.toBe(signatureUnder("a-secret-this-project-never-chose", token));
  });

  /**
   * The forbidden edge, made visible. The environment says one thing, the configuration
   * another, and the instance must hold the configuration's: an instance that read the
   * environment itself would hold the other value and every other test would still pass.
   */
  it("holds the secret it was configured with, not the one the environment offers", async () => {
    const configured = "the-secret-this-project-configured-000000";
    const environment = "the-secret-the-library-must-not-read-0000";
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_SECRET", environment);
    vi.doMock("../../../src/env", () => ({
      env: { ...env, BETTER_AUTH_SECRET: configured },
    }));
    vi.doMock("../../../src/lib/db", async () => ({
      db: (await import("../../support/database")).testDb,
    }));

    const elsewhere = (await import("../../../src/lib/auth")).auth;

    expect((await elsewhere.$context).secret).toBe(configured);
    vi.unstubAllEnvs();
    vi.doUnmock("../../../src/env");
  });
});
