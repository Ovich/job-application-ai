import { type BrowserContext, expect, test } from "@playwright/test";
import { payloadHashOf } from "./support/api";
import { forget, type Person, signedIn, type Where } from "./support/session";

/**
 * Whether a person can sign in, asked of whichever address the project names (US1, US2,
 * US4, US5).
 *
 * No test can drive a provider's own sign-in page, so this proves what can be proven
 * without it: the library answers "who am I" through the mount, each button sends the
 * browser to its provider carrying the address it must come back to, and two people on
 * two browsers see only their own. The provider itself is stood in for at its door. The
 * round trip — press, sign in at the provider, land back signed in — is the person's
 * observation, and each slice's last acceptance criterion.
 *
 * Both projects collect this since S5.5 (ID69). What differs between the two addresses
 * is not the behaviour but what stands in the way of it: deployed, every request crosses
 * origin access control, which signs it and demands the payload hash of any body, and
 * the session cookie has to survive that signing in both directions. The cases that can
 * only be asked there say so themselves.
 */

/** Which address this run is against, and so which registrations and fixture apply. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

/** The callback registered at each provider, per environment (ID61, D9). */
const registeredAt: Record<Where, string> = {
  local: "http://localhost:4200",
  deployed: "https://dev.job-application.app",
};

/**
 * The three doors (D4), and the library's callback as registered at each: a port or a
 * scheme off is a mismatch at the provider's door, not an error here.
 */
const providers = [
  {
    button: "Continue with Google",
    door: "https://accounts.google.com/**",
    doorPattern: /^https:\/\/accounts\.google\.com\//,
    callback: "/api/auth/callback/google",
  },
  {
    button: "Continue with Microsoft",
    door: "https://login.microsoftonline.com/**",
    // The `common` tenant: personal and work accounts alike (D4).
    doorPattern: /^https:\/\/login\.microsoftonline\.com\/common\//,
    callback: "/api/auth/callback/microsoft",
  },
  {
    button: "Continue with LinkedIn",
    door: "https://www.linkedin.com/**",
    doorPattern: /^https:\/\/www\.linkedin\.com\//,
    callback: "/api/auth/callback/linkedin",
  },
];

test("get-session answers nothing when no cookie is presented", async ({ request }) => {
  const answer = await request.get("/api/auth/get-session");

  expect(answer.status()).toBe(200);
  expect(await answer.json()).toBeNull();
});

for (const { button, door, doorPattern, callback } of providers) {
  test(`"${button}" sends the browser to its provider, to come back to this address`, async ({
    page,
  }, testInfo) => {
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
    // on a laptop and in Secrets Manager deployed, and no spec reads either (ID29);
    // `tests/lib/auth` pins it to the configuration.
    expect(sentTo.searchParams.get("client_id")).toBeTruthy();
    expect(sentTo.searchParams.get("redirect_uri")).toBe(
      `${registeredAt[addressOf(testInfo.project.name)]}${callback}`,
    );
    // D11: the identity is the email, so the sign-in asks for it.
    expect(sentTo.searchParams.get("scope")).toContain("email");
  });
}

/**
 * The payload hash and the state cookie, through the distribution (ID58, D5, D6).
 *
 * This is the request the slot's two cloud-only failures live in, and they are read in
 * order. A bodied POST without `x-amz-content-sha256` is refused by the function URL
 * with 403, which `CustomErrorResponses` answers as the page with status 200 — so the
 * first assertion is that JSON came back at all, because HTML here is ID58's failure
 * wearing a success code. Then the cookie: the library sets its `state` cookie on this
 * answer and reads it back on the callback, so a stripped `Set-Cookie` breaks the
 * sign-in before any session exists, which is why it is the first half of criterion 10.
 */
test("a bodied sign-in crosses the signed origin and sets its state cookie", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "deployed",
    "origin access control, and the payload hash it demands, exist only at the deployed address",
  );

  const body = JSON.stringify({ provider: "google", callbackURL: "/" });
  const answer = await request.post("/api/auth/sign-in/social", {
    headers: {
      "content-type": "application/json",
      // What the browser's own client states on every bodied request (ID58): the
      // signature origin access control computes covers a digest CloudFront does not.
      "x-amz-content-sha256": await payloadHashOf(body),
    },
    data: body,
  });

  expect(answer.status()).toBe(200);
  expect(answer.headers()["content-type"]).toContain("application/json");
  const { url } = (await answer.json()) as { url: string };
  expect(new URL(url).origin).toBe("https://accounts.google.com");

  // Criterion 10, outbound: the behaviour caches nothing, so CloudFront has no reason to
  // strip the cookie the library just set, and this is where that stops being a claim.
  const state = answer.headers()["set-cookie"] ?? "";
  expect(state).toContain("better-auth.state");
});

/**
 * Two people, two spaces (US4), and one of them deleting everything (US5). Each browser
 * context has its own cookie jar and `context.request` sends that context's cookies, so
 * `get-session` is asked as that person.
 *
 * Deployed, this is also criterion 10 inbound: the cookie the fixture minted is sent by
 * the browser, crosses origin access control's signing, and the function answers the
 * person it names. A `Cookie` dropped on the way in would show here as a session that
 * never existed.
 *
 * The run writes to whichever database is behind that address, so each run gives its
 * people addresses of their own, and `forget` removes whoever is left.
 */
test.describe("two people on two browsers", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a hook asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
  test.afterAll(async ({}, testInfo) => {
    await forget(addressOf(testInfo.project.name));
  });

  /** Who the library answers for, asked as that context. */
  const whoIs = async (context: BrowserContext): Promise<string | null> => {
    const answer = await context.request.get("/api/auth/get-session");
    const body = (await answer.json()) as { user: { email: string } } | null;
    return body?.user.email ?? null;
  };

  test("each sees only their own session; one signs out and the other stays; the other deletes through the gate", async ({
    browser,
  }, testInfo) => {
    const at = addressOf(testInfo.project.name);
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ada: Person = { name: "Ada Seeker", email: `ada-${run}@example.com` };
    const ben: Person = { name: "Ben Seeker", email: `ben-${run}@example.com` };
    const first = await signedIn(browser, ada, at);
    const second = await signedIn(browser, ben, at);
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
      // The warning first, acknowledged, and only then the code (ID95).
      await gate.getByRole("button", { name: "Acknowledge" }).click();
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
