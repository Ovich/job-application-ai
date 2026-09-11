import { createAuthClient } from "better-auth/client";
import { fetchWithPayloadHash } from "../lib/api";

/**
 * The authentication library's client, constructed once (ID62). Every conversation
 * the web app has with `/api/auth/*` — sign in, who am I, sign out, and later delete —
 * goes through this object and never through a request assembled here: the routes,
 * their bodies and the redirect that follows a sign-in are the library's (board D2).
 *
 * No address is given, so the client speaks to the page's own origin under the
 * library's default base path, `/api/auth`: the dev server forwards it to the API,
 * and in the cloud the distribution serves page and function under one name, exactly
 * as `lib/api.ts` does for the RPC client.
 *
 * It fetches with `lib/api`'s wrapper rather than with the platform's own `fetch`
 * (ID58, D6). Origin access control signs every request that reaches the function and
 * the signature covers a SHA-256 of the body, which CloudFront does not compute: the
 * sender states it in `x-amz-content-sha256`. The library ships its own client with its
 * own fetch, so a sign-in POST would otherwise arrive without the header — a 403 from
 * the function URL, which the distribution answers as the page with status 200, and
 * perfect on a laptop, where there is no signed origin at all.
 *
 * `customFetchImpl` is the library's own slot for it (1.7.4, `client/config`), so no
 * header is computed here and no request is assembled here: the wrapper is passed in as
 * a configuration value, and `tests/app/auth/auth-client.spec.ts` holds it.
 */
export const authClient = createAuthClient({
  fetchOptions: { customFetchImpl: fetchWithPayloadHash },
});
