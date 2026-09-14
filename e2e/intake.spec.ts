import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type TestInfo, test } from "@playwright/test";
import { deletedThroughApp, forget, type Person, signedIn, type Where } from "./support/session";

/**
 * The first half of the person's path, walked for real (criterion 12, `US1`, `US3`).
 *
 * Drop, read, watch the rows follow the run, leave and come back. The rest of that path
 * — the viewer, the questions, the rules — arrives with the slices that build them.
 *
 * This is the one crossing where the browser does the dropping itself: a real file
 * picker, a real multipart body, a real object in storage, and a real stream read frame
 * by frame. Every seam above it stands something in; nothing is stood in for here except
 * the person's sign-in, which no test may drive through a provider's own page.
 *
 * Both projects collect it (agent-consolidation `SL9`, `ID224`). Locally the objects land
 * in the dev server's storage directory; deployed they land in dev's bucket, and dev's
 * function reads them from the recorded readings it bundles. There, every person made
 * here is deleted through the account deletion route, so their objects go with them.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

/** Two of the person's own CVs: the same career, one month, two languages. */
const twoCvs = [`${documents}2026-08-30_cv_FR.pdf`, `${documents}2026-08-30_cv_EN.pdf`];

/** A suffix of this run's own: the deployed environment is shared, and an address is unique. */
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const who = { name: "Stefan Teofanovic", email: `intake-end-to-end-${run}@example.com` };

/** Which address this run is against, and so which database the fixture writes to. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

/** Everyone this file signed in, by the context carrying their session. */
const signedInHere: BrowserContext[] = [];

/** `who` signed in at this project's address, kept for the deletion after the file. */
const signedInAt = async (
  browser: Browser,
  person: Person,
  testInfo: TestInfo,
): Promise<BrowserContext> => {
  const context = await signedIn(browser, person, addressOf(testInfo.project.name));
  signedInHere.push(context);
  return context;
};

// Once, at the end: `forget` lets the database go with it, so a per-test call would leave
// the next sign-in with no connection at all (`support/session.ts`).
// biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a hook asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
test.afterAll(async ({}, testInfo) => {
  const at = addressOf(testInfo.project.name);
  const statuses: number[] = [];
  for (const context of signedInHere.splice(0)) {
    if (at === "deployed") {
      statuses.push((await deletedThroughApp(context, at)).status());
    }
    await context.close();
  }
  await forget(at);
  expect(statuses.every((status) => status === 200)).toBe(true);
});

test("documents dropped are read, and leaving loses nothing", async ({ browser }, testInfo) => {
  // The wait below reads documents through the paced double and carries a timeout of
  // its own. A test may not outlive its own budget, so the budget has to be the
  // larger of the two: at Playwright's default 30s the wait was cut off at half its
  // allowance, and only on a runner slow enough to need it.
  test.setTimeout(90_000);
  const context = await signedInAt(browser, who, testInfo);
  const page = await context.newPage();

  await page.goto("/documents");
  await expect(
    page.getByRole("heading", { name: "Start with what you already have" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Read my documents" })).toBeDisabled();

  // The real picker, the real multipart body, the real objects.
  await page.locator("input[type=file]").setInputFiles(twoCvs);

  await expect(page.getByText("2026-08-30_cv_FR.pdf")).toBeVisible();
  await expect(page.getByText("2026-08-30_cv_EN.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Read my documents" })).toBeEnabled();

  await page.getByRole("button", { name: "Read my documents" }).click();

  // The reading is a state of the same screen, one row per document, and the last row
  // is what happens to them afterwards.
  await expect(page.getByText("Put it together")).toBeVisible();
  await expect(page.getByText("You can leave this page.")).toBeVisible();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(2, {
    timeout: 30_000,
  });

  // Leaving and coming back: the rows are the run, so nothing is lost and nothing is
  // replayed. This is the resume, and it is a read of the list route.
  await page.reload();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(2);
});

test("a typed LinkedIn address alone is accepted, with no file at all", async ({
  browser,
}, testInfo) => {
  // The wait below reads documents through the paced double and carries a timeout of
  // its own. A test may not outlive its own budget, so the budget has to be the
  // larger of the two: at Playwright's default 30s the wait was cut off at half its
  // allowance, and only on a runner slow enough to need it.
  test.setTimeout(90_000);
  const context = await signedInAt(
    browser,
    { ...who, email: `intake-address-only-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Read my documents" })).toBeDisabled();

  await page.getByLabel("Your LinkedIn address").fill("linkedin.com/in/someone");

  await expect(page.getByRole("button", { name: "Read my documents" })).toBeEnabled();

  await page.getByRole("button", { name: "Read my documents" }).click();

  await expect(page.getByText("linkedin.com/in/someone")).toBeVisible();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(1, {
    timeout: 30_000,
  });
});
