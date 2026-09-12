import type { Context } from "hono";
import { auth } from "../auth";

/**
 * The one source of who is asking (`S7.3`, the person's own comment: *"Can we make a
 * module that be the single source of user, auth. Similar to our angular service"*).
 *
 * It is the API's analogue of the web app's `auth/current-user.ts`, which is the Angular
 * service that comment compares it to: one module answers who is asking, one module
 * answers what a route does when nobody is, and a handler above here writes neither
 * again. What it hides is the authentication library's session call and the shape of its
 * answer — a route learns an id and nothing about a header, a cookie, a token or the
 * library that read them.
 *
 * **Its whole value is that `auth.api.getSession` appears once in `src/`.** The day the
 * library's call changes, or the day a route is allowed to answer a person who is not
 * signed in differently, there is one place it happens, and `grep -rn "getSession"
 * apps/api/src` is what says so.
 *
 * It is deliberately this small, and it does not become a user service with reads and
 * writes in it: a module whose interface grows as large as what it hides has stopped
 * hiding anything and is folded back into its caller.
 */

/** Who is asking. An id, because an id is the whole of what a route filters by. */
export type Asking = { id: string };

/** Who is asking, according to the library. `null` is every route's 401. */
export const asking = async (c: Context): Promise<Asking | null> => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session === null ? null : { id: session.user.id };
};

/**
 * What a route answers when nobody is asking: one body and one status, said once.
 *
 * It is a sentence a person could act on rather than a status code repeated in prose,
 * and it is the same sentence at every route, because a person who is not signed in is
 * in the same situation whichever door they knocked at.
 */
export const refused = (c: Context) => c.json({ error: "sign in first" }, 401);
