import { vi } from "vitest";
import type { Provider } from "../../src/app/auth/session";

/**
 * The library's client stood in for at the network (ID78). The app talks to `/api/auth/*`
 * only through that client, and the client's own seam is `fetch`: it takes the platform's
 * once, when it is built. So this file replaces `fetch` before any client exists, and a
 * test says, per case, who the library should answer as.
 *
 * What is hidden here is everything a test must not know: the library's route names,
 * the shape of each answer, and the hoisting. This module is a `setupFiles` entry of the
 * unit-test builder (`angular.json`), which runs it before a spec's imports, so the
 * client built by `auth/auth-client` finds the stand-in already in place. That is what
 * `sign-in.spec.ts` did inline with `vi.hoisted` before this file took it over.
 *
 * The answers are the library's at its defaults (D20): `get-session` answers `null`
 * with no session and `{ session, user }` with one; `list-accounts` lists the linked
 * providers as the library does; `sign-in/social` answers `{ url: null, redirect: false }`
 * so nothing leaves the page; `sign-out` answers ok and thereafter there is no session;
 * `delete-user` answers `{ success: true, message: "User deleted" }` and thereafter there
 * is no session either, since the library clears the cookie itself. A route told to fail
 * answers its status as the library would, until reset (ID91). A route not stood in for
 * throws, naming the address, so a test cannot pass by accident on a request nobody
 * expected.
 */

export type Identity = { name: string; email: string; providers: Provider[] };

type Sent = { method: string; body: unknown };

/** The library's base path, the client's default. */
const basePath = "/api/auth/";

/** Who the library answers as, or nobody. */
let who: Identity | null = null;

/** Whether the library can be reached at all. */
let reachable = true;

/** The routes told to fail, and the status each answers. */
let failures = new Map<string, number>();

/** What has left for each library route, in order of leaving. */
let sent = new Map<string, Sent[]>();

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** The library's `get-session` answer for `who`. */
const sessionOf = (identity: Identity) => ({
  session: { id: "session-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  user: {
    id: "user-1",
    name: identity.name,
    email: identity.email,
    emailVerified: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
});

/**
 * The library's `list-accounts` answer: one row per linked provider, each stamped with
 * when it was linked, so a caller that orders by `createdAt` gets the order given. The
 * rows are handed back newest first on purpose: a caller that trusts the wire order
 * instead of the stamp shows the providers backwards.
 */
const accountsOf = (identity: Identity) =>
  identity.providers
    .map((providerId, index) => ({
      id: `account-${index + 1}`,
      providerId,
      accountId: `${providerId}-${index + 1}`,
      scopes: ["openid", "profile", "email"],
      createdAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
    }))
    .reverse();

/** The library's error answer: a JSON body with a code and a message, and the status. */
const failure = (status: number): Response =>
  new Response(
    JSON.stringify({ code: "STOOD_IN_FOR_FAILURE", message: "stood in for a failure" }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );

const answer = (route: string): Response => {
  const status = failures.get(route);
  if (status !== undefined) {
    return failure(status);
  }
  switch (route) {
    case "get-session":
      return json(who === null ? null : sessionOf(who));
    case "list-accounts":
      return json(who === null ? [] : accountsOf(who));
    case "sign-in/social":
      return json({ url: null, redirect: false });
    case "sign-out":
      who = null;
      return json({ success: true });
    case "delete-user":
      who = null;
      return json({ success: true, message: "User deleted" });
    default:
      throw new Error(`no stand-in for the library route ${basePath}${route}`);
  }
};

const addressOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);

const standIn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const address = addressOf(input);
  if (!reachable) {
    throw new TypeError("Failed to fetch");
  }
  const at = address.indexOf(basePath);
  if (at < 0) {
    throw new Error(`no stand-in for a request outside the library: ${address}`);
  }
  const route = address.slice(at + basePath.length).split("?")[0] ?? "";
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  sent.set(route, [...(sent.get(route) ?? []), { method, body }]);
  return answer(route);
});

vi.stubGlobal("fetch", standIn);

/** `get-session` answers `who`; `list-accounts` their providers, in the order linked. */
export const signedInAs = (identity: Identity): void => {
  who = identity;
};

/** `get-session` answers null. */
export const signedOut = (): void => {
  who = null;
};

/** Every request fails the way a browser's does when nothing answers. */
export const unreachable = (): void => {
  reachable = false;
};

/** That route answers `status`, as the library would, until reset. */
export const failing = (route: string, status: number): void => {
  failures.set(route, status);
};

/** What left for one library route, in order. */
export const sentTo = (route: string): Sent[] => sent.get(route) ?? [];

/** Between tests: nobody signed in, nothing sent. */
export const reset = (): void => {
  who = null;
  reachable = true;
  failures = new Map();
  sent = new Map();
  standIn.mockClear();
};
