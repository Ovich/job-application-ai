import { auth } from "../../src/lib/auth";
import { type Identity, type Provider, standIn } from "./providers";

/**
 * A sign-in, round trip, through the library's own routes.
 *
 * The press on the button, then the browser coming back from the provider with a
 * code: the sign-in that stores its `state`, then the callback that redeems it,
 * exchanges the code, reads the profile, and signs in, links or refuses. The `state`
 * travels as the library sends it, in the address it gave the browser and in the
 * cookie it set. Only the provider is stood in for (`tests/support/providers.ts`);
 * no code here reproduces a step of the flow, and what a test reads afterwards is the
 * library's answer, through its routes or in its tables.
 *
 * `auth` is the API's own instance, over whatever `lib/db` resolves to: a test file
 * that mocks it to the in-process PostgreSQL (`tests/support/database.ts`) before
 * importing this module drives the round trip against that database.
 */

/** Where the browser reaches the app, and so where a provider sends it back to. */
const appUrl = "http://localhost:4200";

/** The cookies a response set, as the browser would send them back. */
export const cookiesSetBy = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/** The round trip, for one provider and what it says about the person. */
export const signInThrough = async (provider: Provider, who: Identity): Promise<Response> => {
  const started = await auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({ provider, callbackURL: "/" }),
    }),
  );
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";

  standIn(provider, who);
  return auth.handler(
    new Request(`${appUrl}/api/auth/callback/${provider}?code=stood-in-for-code&state=${state}`, {
      headers: { cookie: cookiesSetBy(started) },
    }),
  );
};

/** Where the callback sent the browser. */
export const landingOf = (response: Response) =>
  new URL(response.headers.get("location") ?? "", appUrl);

/** Who the callback's cookies say is signed in: the library's own answer. */
export const signedInAs = async (response: Response) => {
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookiesSetBy(response) }),
  });
  return session?.user ?? null;
};
