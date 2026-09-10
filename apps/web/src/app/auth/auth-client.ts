import { createAuthClient } from "better-auth/client";

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
 * On localhost there is no signed origin, so the client fetches with the platform's
 * own `fetch`. Handing it `fetchWithPayloadHash` is S5.3's (ID58), the day a request
 * from here crosses origin access control.
 */
export const authClient = createAuthClient();
