import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type TestInfo, test } from "@playwright/test";
import { forget, type Person, signedIn, type Where } from "./support/session";

/**
 * The second reading, walked for real (SL11, `ID308`, `ID315`, `ID316`).
 *
 * A person hands over one CV and gets a profile. Then they follow the one way the profile
 * has back to their documents, hand over a second CV, press Read, and watch the profile
 * grow: everything the first reading wrote is still there with the same id, and what the
 * second document adds is beside it.
 *
 * This is the walk that could not be made before that slice. The two readings asked for
 * the same recorded case, so the second one was answered with a first reading's profile
 * and inserted it all again; and a recording could not name an item's id, because an id
 * is a `randomUUID` that does not exist until the profile is written. Both are why the
 * claim below — same ids, new lines — is worth walking in a browser.
 *
 * It used to answer a question between the two readings and check the concern survived,
 * and to read the second reading's own notice in the conversation. Product-flow-rework
 * `S2.1` took the assistant off this page (`ID331`): there is nothing here that asks and
 * nothing that says a reading landed but the profile itself, which is what it watches now.
 * What a second reading does to a concern already settled is owed to `profile-assistant`,
 * along with the notice, and `intake-questions.spec.ts` is parked holding that walk.
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

test("a second reading adds to the profile, and replaces nothing the first one wrote", async ({
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

  /** Every item and line the first reading wrote, by the id the page draws it under. */
  const idsBefore = await page
    .locator("[data-region][data-id]")
    .evaluateAll((regions) => regions.map((region) => region.getAttribute("data-id") ?? ""));
  expect(idsBefore.length).toBeGreaterThan(30);
  const linesBefore = await page
    .locator("[data-row=line]")
    .evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
  expect(linesBefore.length).toBeGreaterThan(0);

  // The way back to the documents is on the profile itself: `Add documents` opens the drop
  // zone over the page the person is reading (`ID160`, D15), which is the same
  // `documents-drop-zone` the `/documents` screen renders, embedded. Nothing here types an
  // address, and nothing needs a second way in (`ID319`).
  await page.getByRole("button", { name: "Add documents" }).click();

  // The second reading: the other CV, over the profile that already exists.
  await page.locator("input[type=file]").setInputFiles([cvOwnership]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(2, { timeout: 60_000 });

  // Embedded, the last button says Done and hands back to the profile holding the modal.
  await page.getByRole("button", { name: "Done" }).click();

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();
  // What says the second reading has landed is the profile itself growing: there is no
  // conversation on this page to carry the reading's notice any more (`ID331`), so the
  // page is polled until it draws more regions than the first reading wrote.
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

  // One profile out of both, said without counting documents: the sheet stopped printing
  // how many a part came from (product-flow-rework `S2.2`, `H10`). What says both CVs fed
  // this one profile is a thing only the first states drawn beside a thing only the
  // second states.
  await expect(page.getByText("Charrette").first()).toBeVisible();
  await expect(page.getByText("Windows Server & AD").first()).toBeVisible();
});
