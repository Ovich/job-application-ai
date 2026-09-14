import { serializeSigned } from "hono/utils/cookie";
import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { auth } from "../src/lib/auth";

/**
 * What the application answers at its edges: an unknown path, and the paths it hands
 * to the authentication library.
 *
 * The database is a real PostgreSQL in this process, built from the project's own
 * migrations (`tests/support/database.ts`), so the library's tables are the ones the
 * deploy will create and nothing here describes them a second time.
 */
vi.mock("../src/lib/db", async () => ({ db: (await import("./support/database")).testDb }));

/**
 * Hono's default is `text/plain`, which was invisible while every `/api` path belonged
 * to a handler that wrote its own JSON error. With the runs routes gone, an unknown
 * `/api` path reached that default and the deployed check caught it: a client that
 * parses every API answer as JSON gets a syntax error instead of a message it can read.
 */
describe("an unknown path", () => {
  it("is answered as JSON, like every other API answer", async () => {
    const answer = await app.request("/api/nope");

    expect(answer.status).toBe(404);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(await answer.json()).toEqual({ error: "no such route" });
  });
});

/**
 * The mock's mount (ID110). It is a sibling of `/api`, not a path under it, and that is
 * not tidiness: the deployed distribution has a behaviour for `/api/*` that disables
 * caching and forwards headers, and a double mounted under it would inherit that
 * behaviour and be reachable by any client of the product's own API.
 *
 * The base URL a caller is given therefore ends at `/mock/v1`, which is what the client
 * expects to append `/chat/completions` to.
 */
describe("the AI mock's mount", () => {
  it("answers outside the /api base path", async () => {
    const answer = await app.request("/mock/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Jobapp-Case": "nothing.at:all" },
      body: JSON.stringify({ model: "m", messages: [] }),
    });

    // A miss, because no such case is recorded — but a miss from the mock's own handler,
    // which answers its placeholder (`ID166`), and that is what proves the path is matched.
    expect(answer.status).toBe(200);
    expect(
      ((await answer.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message
        .content,
    ).toBe("No pre generated text");
  });

  it("adds no route under /api, so the SPA's routes and the distribution are untouched", async () => {
    const answer = await app.request("/api/mock/v1/chat/completions", { method: "POST" });

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({ error: "no such route" });
  });
});

/**
 * The library's own routes, reached through the one mount the API gives them (ID59):
 * there is no `/api/me` and no sign-in route of ours, and "who am I" is the library's
 * `get-session`. Two answers are what US4's isolation and SL5's cookie question will
 * be written against: nothing without a cookie, the person with one.
 */
describe("the library's routes, mounted at /api/auth", () => {
  it("answers get-session with nothing when no cookie is presented", async () => {
    const answer = await app.request("/api/auth/get-session");

    expect(answer.status).toBe(200);
    expect(await answer.json()).toBeNull();
  });

  it("answers get-session with the person whose session the cookie carries", async () => {
    // A person and a session the library made through its own adapter, so no row is
    // hand-written to a shape the library might not read back. Nobody's data: the
    // fixture is a name and an address at the reserved example domain.
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: "someone@example.com", name: "Someone", emailVerified: true },
      // Where the person came from, as far as the library is concerned: a Google
      // sign-in, which is the only door this product has.
      { method: "oauth", oauth: { providerId: "google" } },
    );
    const session = await context.internalAdapter.createSession(user.id);

    // The cookie a sign-in would have ended with: the library's own name for it, the
    // session's token, signed with the library's secret. Hono's signed-cookie format
    // is the one better-call, the library's router, inherited from it: `token.signature`,
    // the signature base64 of an HMAC-SHA256, the whole percent-encoded.
    const cookie = await serializeSigned(
      context.authCookies.sessionToken.name,
      session.token,
      context.secret,
    );

    const answer = await app.request("/api/auth/get-session", { headers: { cookie } });

    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { user: { id: string; email: string } };
    expect(body.user).toMatchObject({ id: user.id, email: "someone@example.com" });
  });
});
