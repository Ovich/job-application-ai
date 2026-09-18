import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type TestInfo, test } from "@playwright/test";
import { forget, type Person, signedIn, type Where } from "./support/session";

/**
 * The second reading, walked for real (SL11, `ID308`, `ID315`, `ID316`).
 *
 * A person hands over one CV and gets a profile. They answer a question about it. Then
 * they follow the one link the profile has to their documents, hand over a second CV,
 * press Read, and watch the profile grow: everything the first reading wrote is still
 * there with the same id, what the second document adds is beside it, and what they
 * settled is untouched.
 *
 * This is the walk that could not be made before this slice. The two readings asked for
 * the same recorded case, so the second one was answered with a first reading's profile
 * and inserted it all again; and a recording could not name an item's id, because an id
 * is a `randomUUID` that does not exist until the profile is written. Both are why the
 * claim below — same ids, new lines, kept concerns — is worth walking in a browser.
 *
 * The local project alone. The recordings and the fixtures are here, but a run against
 * the development environment would write a second profile into a shared database for no
 * question this address cannot already answer.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

/** The English CV, and the same career written for another kind of post (`ID317`). */
const cvEnglish = `${documents}2026-08-30_cv_EN.pdf`;
const cvOwnership = `${documents}2026-09-09_cv-en_ownership-application-management.pdf`;

/** A suffix of this run's own, as the other intake specs take one. */
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const signedInHere: BrowserContext[] = [];

const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

const signedInAt = async (
  browser: Browser,
  person: Person,
  testInfo: TestInfo,
): Promise<BrowserContext> => {
  const context = await signedIn(browser, person, addressOf(testInfo.project.name));
  signedInHere.push(context);
  return context;
};

// biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a hook asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
test.afterAll(async ({}, testInfo) => {
  for (const context of signedInHere.splice(0)) await context.close();
  await forget(addressOf(testInfo.project.name));
});

test("a second reading adds to the profile, and loses nothing the person settled", async ({
  browser,
}, testInfo) => {
  // Two readings through the paced double, each with a wait of its own: a test may not
  // outlive its own budget.
  test.setTimeout(180_000);
  const context = await signedInAt(
    browser,
    { name: "Stefan Teofanovic", email: `second-reading-end-to-end-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  // The first reading: one CV, one profile.
  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([cvEnglish]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(1, { timeout: 60_000 });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(page.locator("profile-assistant")).toHaveAttribute("data-guide", "done", {
    timeout: 30_000,
  });

  /** Every item and line the first reading wrote, by the id the page draws it under. */
  const idsBefore = await page
    .locator("[data-region][data-id]")
    .evaluateAll((regions) => regions.map((region) => region.getAttribute("data-id") ?? ""));
  expect(idsBefore.length).toBeGreaterThan(30);
  const linesBefore = await page
    .locator("[data-row=line]")
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  expect(linesBefore.length).toBeGreaterThan(0);

  // One question answered, so the second reading has something of the person's to lose.
  const count = page.locator("[data-part=count]");
  await expect(page.locator("scope-tool")).toBeVisible();
  const picked = page.locator("[data-action=alt]").first();
  const concern = (await picked.getAttribute("data-concern")) ?? "";
  expect(concern).not.toBe("");
  await picked.click();
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^1 of \d+ answered$/);

  // The way back to the documents is on the profile, so nothing here types an address.
  await page.getByRole("link", { name: "My documents" }).click();
  await expect(page).toHaveURL(/\/documents$/);

  // The second reading: the other CV, over the profile that already exists.
  await page.locator("input[type=file]").setInputFiles([cvOwnership]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(2, { timeout: 60_000 });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();
  // A returning visit performs nothing — the column lands what is stored at once and
  // writes no `data-guide` — so what says the second reading has landed is the reading's
  // own notice in the conversation, naming the document it read (`ID311`).
  await expect(page.locator("profile-assistant")).toContainText(
    "2026-09-09_cv-en_ownership-application-management",
    { timeout: 30_000 },
  );
  await expect
    .poll(() => page.locator("[data-region][data-id]").count(), { timeout: 30_000 })
    .toBeGreaterThan(idsBefore.length);

  // Nothing was replaced: every id the first reading wrote is still on the page.
  const idsAfter = new Set(
    await page
      .locator("[data-region][data-id]")
      .evaluateAll((regions) => regions.map((region) => region.getAttribute("data-id") ?? "")),
  );
  expect(idsBefore.filter((id) => !idsAfter.has(id))).toEqual([]);
  const linesAfter = await page
    .locator("[data-row=line]")
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  expect(linesBefore.filter((line) => !linesAfter.includes(line))).toEqual([]);
  expect(idsAfter.size).toBeGreaterThan(idsBefore.length);

  // What the second document brought: an item the profile did not have at all, and a new
  // line on an item the first reading wrote.
  await expect(page.getByText("Windows Server & AD").first()).toBeVisible();
  await expect(
    page.getByText("Cypress end-to-end suites authored to autograde student web labs", {
      exact: false,
    }),
  ).toBeVisible();

  // What the person settled is where they left it, and so is the question they answered.
  await expect(page.locator("[data-part=concern]").filter({ hasText: concern })).toHaveCount(1);
  await expect(count).toHaveText(/^1 of \d+ answered$/);

  // And what that notice says the reading did: it added to items the profile already had.
  await expect(page.locator("profile-assistant")).toContainText("added to");
});

test("two documents handed over at once are one reading, and one profile from both", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const context = await signedInAt(
    browser,
    { name: "Stefan Teofanovic", email: `two-at-once-end-to-end-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([cvEnglish, cvOwnership]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(2, { timeout: 60_000 });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();

  // One profile out of both: a fact both CVs state carries a source apiece, which is what
  // the sheet prints beside it.
  await expect(
    page.locator("[data-part=from]").filter({ hasText: "2 documents" }).first(),
  ).toBeVisible();
  await expect(page.getByText("Windows Server & AD").first()).toBeVisible();
});
