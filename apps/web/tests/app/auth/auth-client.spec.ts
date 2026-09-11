import { afterEach, describe, expect, it, vi } from "vitest";
import { authClient } from "../../../src/app/auth/auth-client";

/**
 * The payload hash on the library's own requests (ID58, D6, seam C).
 *
 * `lib/api`'s wrapper already states `x-amz-content-sha256` on everything the RPC
 * client sends, and its own seam holds the arithmetic. What is asked here is the thing
 * only this seam can answer: that the authentication library's client sends through that
 * same wrapper. The library builds the request — its route, its body, its headers — and
 * the wrapper states the digest of the bytes that leave.
 *
 * It is dead configuration on a laptop and not optional in the cloud: origin access
 * control signs the request that reaches the function and the signature covers a
 * SHA-256 of the body, which CloudFront does not compute. A sign-in POST arriving
 * without the header is refused by the function URL with 403, which the distribution
 * answers as the page with status 200 — HTML where JSON was expected, the failure this
 * test exists so nobody has to diagnose.
 *
 * The network is stood in for here rather than through `tests/support/session`, because
 * what is read is the headers, which that stand-in does not keep. The digests were
 * computed outside this program, so a mistake in the wrapper cannot agree with the same
 * mistake made again here.
 */

const payloadHash = "x-amz-content-sha256";

/** The body the library sends for a sign-in, and the SHA-256 of its bytes. */
const signInBody = '{"provider":"google","callbackURL":"/"}';
const digestOfSignInBody = "409db7667c4707c667b5a3e901e65b4543d21bd35532aff940106ba592924897";

/** The same, with a callback whose characters and bytes differ: one é, one byte more. */
const accentedCallback = "/café";
const accentedSignInBody = '{"provider":"google","callbackURL":"/café"}';
const digestOfAccentedBody = "7f3f78b3affc1cdd97cf653b689322a261a8c72ab6c7a7c6901e32cbe4ab0284";

type Fetching = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Stands in for the network and keeps what the library handed it. */
const captureRequests = () => {
  const fetching = vi.fn<Fetching>(
    async () =>
      new Response(JSON.stringify({ url: null, redirect: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetching);
  return fetching;
};

/** The address, the body and the headers of the one request that left. */
const requestSentTo = (fetching: ReturnType<typeof captureRequests>) => {
  const call = fetching.mock.calls[0];
  const [input, init] = call ?? [];
  return {
    address: input instanceof Request ? input.url : String(input),
    body: init?.body,
    headers: new Headers(init?.headers),
  };
};

describe("the library's client", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("states the digest of the body the library sends", async () => {
    const fetching = captureRequests();

    await authClient.signIn.social({ provider: "google", callbackURL: "/" });

    const { body, headers } = requestSentTo(fetching);
    expect(body).toBe(signInBody);
    expect(headers.get(payloadHash)).toBe(digestOfSignInBody);
  });

  it("hashes the bytes that leave, not the characters they were written in", async () => {
    const fetching = captureRequests();

    await authClient.signIn.social({ provider: "google", callbackURL: accentedCallback });

    const { body, headers } = requestSentTo(fetching);
    expect(body).toBe(accentedSignInBody);
    // One byte longer than it is long in characters, which is the whole point: a digest
    // taken over the characters would not be this one.
    expect(new TextEncoder().encode(String(body)).byteLength).toBe(accentedSignInBody.length + 1);
    expect(headers.get(payloadHash)).toBe(digestOfAccentedBody);
  });

  it("sends no digest on a call that carries no body", async () => {
    const fetching = captureRequests();

    await authClient.getSession();

    const { body, headers } = requestSentTo(fetching);
    expect(body ?? null).toBeNull();
    expect(headers.has(payloadHash)).toBe(false);
  });

  /**
   * No address is given to the client, so it speaks to the page's own origin under the
   * library's default base path. In the cloud the distribution serves page and function
   * under one name, which is what makes that the right address there too.
   */
  it("still speaks to the page's own origin under /api/auth", async () => {
    const fetching = captureRequests();

    await authClient.getSession();

    expect(requestSentTo(fetching).address).toContain(`${globalThis.location.origin}/api/auth/`);
  });
});
