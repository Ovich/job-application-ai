import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../src/app/lib/api";

/**
 * The payload hash the client states on every request that carries a body (ID10).
 *
 * Slice 2 puts the function behind origin access control, which signs the request that
 * reaches it, and that signature covers a SHA-256 of the body CloudFront does not
 * compute: the sender declares it in `x-amz-content-sha256`. A wrong value there is a
 * 403 in the cloud and nothing at all locally, which is exactly the kind of behaviour
 * that has to be held by a test that needs no cloud.
 *
 * The digests below were computed outside this program, so a mistake in the client
 * cannot agree with the same mistake made again here.
 */

/** SHA-256 of the 25 bytes of `{"kind":"demo","units":3}`, lowercase hexadecimal. */
const digestOfDemoRun = "af931bd18db5b2aadb44848c2aaccb854cf2a2cf9950ecb2ca488c115a8b5ac4";

/** SHA-256 of `{"kind":"démo","units":1}`: 25 characters, 26 bytes once encoded. */
const digestOfAccentedRun = "bcadd2030f2612b1079de5232635429169442d0b275400c1a438bb94c6e72221";

const payloadHash = "x-amz-content-sha256";

type Fetching = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Stands in for the network and keeps what was handed to it. */
function captureRequests() {
  const fetching = vi.fn<Fetching>(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetching);
  return fetching;
}

/** The body and the headers of the one request that left. */
function requestSentTo(fetching: ReturnType<typeof captureRequests>) {
  const init = fetching.mock.calls[0]?.[1];
  return { body: init?.body, headers: new Headers(init?.headers) };
}

describe("the API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("states the digest of the body it sends", async () => {
    const fetching = captureRequests();

    await api.runs.$post({ json: { kind: "demo", units: 3 } });

    const { body, headers } = requestSentTo(fetching);
    expect(body).toBe('{"kind":"demo","units":3}');
    expect(headers.get(payloadHash)).toBe(digestOfDemoRun);
  });

  it("hashes the bytes that leave, not the characters they were written in", async () => {
    const fetching = captureRequests();

    await api.runs.$post({ json: { kind: "démo", units: 1 } });

    const { body, headers } = requestSentTo(fetching);
    // The body is one character shorter than it is long in bytes, which is the whole
    // point: a digest taken over characters would not be this one.
    expect(new TextEncoder().encode(String(body)).byteLength).toBe(26);
    expect(String(body)).toHaveLength(25);
    expect(headers.get(payloadHash)).toBe(digestOfAccentedRun);
  });

  it("sends no digest when there is no body", async () => {
    const fetching = captureRequests();

    await api.runs.latest.$get();

    const { body, headers } = requestSentTo(fetching);
    expect(body).toBeUndefined();
    expect(headers.has(payloadHash)).toBe(false);
  });
});
