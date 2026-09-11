import { type BrowserContext, expect, test } from "@playwright/test";
import { forget, type Person, signedIn } from "./support/session";

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

/**
 * Two people, two spaces (US4), and one of them deleting everything (US5), on the local
 * stack. Each browser context has its own cookie jar and `context.request` sends that
 * context's cookies, so `get-session` is asked as that person. The two are signed in by
 * the library's own test helpers (`support/session`, ID92), since no test drives a
 * provider; the round trip and the new, empty user after a deletion are the person's
 * observation and the API's seam A.
 *
 * The run writes to the dev server's own database, so each run gives its people
 * addresses of their own, and `forget` removes whoever is left.
 */
test.describe("two people on two browsers", () => {
  test.afterAll(async () => {
    await forget();
  });

  /** Who the library answers for, asked as that context. */
  const whoIs = async (context: BrowserContext): Promise<string | null> => {
    const answer = await context.request.get("/api/auth/get-session");
    const body = (await answer.json()) as { user: { email: string } } | null;
    return body?.user.email ?? null;
  };

  test("each sees only their own session; one signs out and the other stays; the other deletes through the gate", async ({
    browser,
  }) => {
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ada: Person = { name: "Ada Seeker", email: `ada-${run}@example.com` };
    const ben: Person = { name: "Ben Seeker", email: `ben-${run}@example.com` };
    const first = await signedIn(browser, ada);
    const second = await signedIn(browser, ben);
    const adaPage = await first.newPage();
    const benPage = await second.newPage();

    await test.step("each get-session answers its own person, and each menu names its own", async () => {
      expect(await whoIs(first)).toBe(ada.email);
      expect(await whoIs(second)).toBe(ben.email);
      for (const [page, who, other] of [
        [adaPage, ada, ben],
        [benPage, ben, ada],
      ] as const) {
        await page.goto("/profile");
        await page.getByRole("button", { name: "Your account" }).click();
        const menu = page.getByRole("menu");
        await expect(menu).toContainText(who.email);
        await expect(menu).not.toContainText(other.email);
      }
    });

    await test.step("one signs out: its /profile sends it to /, and the other still answers", async () => {
      await adaPage.getByRole("menuitem", { name: "Sign out" }).click();
      await adaPage.waitForURL((url) => url.pathname === "/");
      expect(await whoIs(first)).toBeNull();
      await adaPage.goto("/profile");
      await adaPage.waitForURL((url) => url.pathname === "/");
      expect(await whoIs(second)).toBe(ben.email);
    });

    await test.step("the other deletes through the gate, typing the code it shows", async () => {
      await benPage.getByRole("menuitem", { name: "Delete my account" }).click();
      const gate = benPage.getByRole("dialog", { name: "Delete your account?" });
      await expect(gate).toBeVisible();
      await expect(gate.getByRole("button", { name: "Delete account" })).toBeDisabled();
      // A pattern is matched against the element's text as written, its template's
      // line breaks around the code included, so they are allowed for and trimmed.
      const code = (await gate.getByText(/^\s*[A-Z0-9]{8}\s*$/).textContent())?.trim() ?? "";
      await gate.getByRole("textbox").fill(code);
      await gate.getByRole("button", { name: "Delete account" }).click();

      await benPage.waitForURL((url) => url.pathname === "/" && url.searchParams.has("deleted"));
      await expect(benPage.getByText("Your account is deleted.")).toBeVisible();
      expect(await whoIs(second)).toBeNull();
      await benPage.goto("/profile");
      await benPage.waitForURL((url) => url.pathname === "/");
    });

    await first.close();
    await second.close();
  });
});
