import { expect, test } from "@playwright/test";

/**
 * Whether a person can start signing in on a laptop (US1), asked of the local stack
 * through the dev server's proxy, which is the same front door the page uses.
 *
 * No test can drive Google's own sign-in page, so this proves what can be proven
 * without it: the library answers "who am I" through the mount, and the button sends
 * the browser to Google carrying the address it must come back to. Google itself is
 * stood in for at its door. The round trip — press, sign in, land back signed in — is
 * the person's observation, and the slice's last acceptance criterion.
 *
 * The `local` project alone collects this (ID69); the deployed one widens at S5.5,
 * when the cloud has a client app of its own.
 */

/** The library's callback, as registered at Google for localhost. A port off is a mismatch. */
const registeredRedirectUri = "http://localhost:4200/api/auth/callback/google";

test("get-session answers nothing when no cookie is presented", async ({ request }) => {
  const answer = await request.get("/api/auth/get-session");

  expect(answer.status()).toBe(200);
  expect(await answer.json()).toBeNull();
});

test("the button sends the browser to Google, to come back to this address", async ({ page }) => {
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>Google, stood in for</title>",
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/^https:\/\/accounts\.google\.com\//);

  const sentTo = new URL(page.url());
  // The client the API was given, whichever it is: the value lives in the API's `.env`
  // and no spec reads the environment (ID29); `tests/lib/auth` pins it to the config.
  expect(sentTo.searchParams.get("client_id")).toBeTruthy();
  expect(sentTo.searchParams.get("redirect_uri")).toBe(registeredRedirectUri);
  // D11: the identity is the email, so the sign-in asks for it.
  expect(sentTo.searchParams.get("scope")).toContain("email");
});
