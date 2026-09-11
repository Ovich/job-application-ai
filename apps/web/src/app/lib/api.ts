import type { AppType } from "@app/api";
import { hc } from "hono/client";

/**
 * The typed client for the API (ID5). It exposes `api` and hides two things: where the
 * API lives, and the payload hash the deployed distribution will demand.
 *
 * The address is the page's own origin, in every environment. In the cloud the
 * distribution serves the page and the function under one name; in development
 * `proxy.conf.json` forwards `/api` to the local Node server. So no call site ever
 * learns a host, and there is no cross-origin request to configure.
 *
 * Types travel from the Drizzle schema through the API's `AppType` and arrive here
 * inferred. Nothing about a response is declared in this application: a caller reads a
 * shape with `InferResponseType<typeof api.…$get, 200>`.
 */

const textEncoder = new TextEncoder();

/** The digest the AWS header is specified in: SHA-256, lowercase hexadecimal. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `fetch`, plus the header a signed origin requires. Origin access control signs the
 * request that reaches the function and the signature covers a SHA-256 of the body,
 * which CloudFront does not compute: the sender states it in `x-amz-content-sha256`
 * and the signature carries that claim through. A request with no body is sent
 * untouched, which is why no read carries the header.
 *
 * Exported for its own test, and kept although `main` carries no write yet: SL10
 * removed the run skeleton and D11's conversation brings the first write back. Origin
 * access control is already in the distribution, so the first write that reaches it
 * without this header is a 403 in the cloud and nothing at all locally — the kind of
 * failure that has to be held by a test rather than discovered.
 *
 * The RPC client sends JSON, so the body is a string and goes out as it came in. Any
 * other kind is read into bytes first and those exact bytes are what is sent, so the
 * hash can never describe something other than what was transmitted. `crypto.subtle`
 * is the platform's, so nothing is installed to compute a digest.
 */
export async function fetchWithPayloadHash(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);

  if (typeof body === "string") {
    headers.set("x-amz-content-sha256", await sha256Hex(textEncoder.encode(body)));
    return fetch(input, { ...init, headers });
  }

  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  headers.set("x-amz-content-sha256", await sha256Hex(bytes));
  return fetch(input, { ...init, body: bytes, headers });
}

/**
 * The API, reachable as the routes read: `api.health.$get()`. The `/api` prefix
 * the server mounts under is part of the type, so it is part of the path here and is
 * not repeated in the address.
 */
/**
 * The page's own origin, and the empty string while there is no page.
 *
 * This module is read during the entry route's prerender since S5.3 (`auth/auth-client`
 * takes its fetch from here), and a server rendering HTML has no `location`: read
 * unguarded, it threw at module load and the route answered 500 with nothing rendered —
 * which `e2e/entry-route.spec.ts` is what caught. The address is only ever used by a
 * call, and no call is made while the page is being rendered on the server, so the
 * empty string is never sent anywhere.
 */
const pageOrigin = (globalThis as { location?: Location }).location?.origin ?? "";

export const api = hc<AppType>(pageOrigin, {
  fetch: fetchWithPayloadHash,
}).api;
