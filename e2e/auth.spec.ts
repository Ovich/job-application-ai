import { expect, test } from "@playwright/test";

/**
 * Whether a person can start signing in on a laptop (US1, and US2's second button),
 * asked of the local stack through the dev server's proxy, which is the same front
 * door the page uses.
 *
 * No test can drive a provider's own sign-in page, so this proves what can be proven
 * without it: the library answers "who am I" through the mount, and each button sends
 * the browser to its provider carrying the address it must come back to. The provider
 * itself is stood in for at its door. The round trip — press, sign in, land back signed
 * in, and land on the same user through a second provider — is the person's
 * observation, and each slice's last acceptance criterion.
 *
 * The `local` project alone collects this (ID69); the deployed one widens at S5.5,
 * when the cloud has client apps of its own.
 */

/**
 * The three doors (D4), and the library's callback as registered at each for localhost:
 * a port off is a mismatch at the provider's door, not an error here.
 */
const providers = [
  {
    button: "Continue with Google",
    door: "https://accounts.google.com/**",
    doorPattern: /^https:\/\/accounts\.google\.com\//,
    registeredRedirectUri: "http://localhost:4200/api/auth/callback/google",
  },
  {
    button: "Continue with Microsoft",
    door: "https://login.microsoftonline.com/**",
    // The `common` tenant: personal and work accounts alike (D4).
    doorPattern: /^https:\/\/login\.microsoftonline\.com\/common\//,
    registeredRedirectUri: "http://localhost:4200/api/auth/callback/microsoft",
  },
  {
    button: "Continue with LinkedIn",
    door: "https://www.linkedin.com/**",
    doorPattern: /^https:\/\/www\.linkedin\.com\//,
    registeredRedirectUri: "http://localhost:4200/api/auth/callback/linkedin",
  },
];

test("get-session answers nothing when no cookie is presented", async ({ request }) => {
  const answer = await request.get("/api/auth/get-session");

  expect(answer.status()).toBe(200);
  expect(await answer.json()).toBeNull();
});

for (const { button, door, doorPattern, registeredRedirectUri } of providers) {
  test(`"${button}" sends the browser to its provider, to come back to this address`, async ({
    page,
  }) => {
    await page.route(door, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>The provider, stood in for</title>",
      }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: button }).click();
    await page.waitForURL(doorPattern);

    const sentTo = new URL(page.url());
    // The client the API was given, whichever it is: the value lives in the API's `.env`
    // and no spec reads the environment (ID29); `tests/lib/auth` pins it to the config.
    expect(sentTo.searchParams.get("client_id")).toBeTruthy();
    expect(sentTo.searchParams.get("redirect_uri")).toBe(registeredRedirectUri);
    // D11: the identity is the email, so the sign-in asks for it.
    expect(sentTo.searchParams.get("scope")).toContain("email");
  });
}
