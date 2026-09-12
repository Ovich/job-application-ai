import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { forget, signedIn } from "./support/session";

/**
 * The second half of the person's path, walked for real (criterion 12, `US4`, `US9`).
 *
 * Drop, read, then open the profile and count what is on the screen against what the
 * interface answered. It is the one place criteria 8 and 10 can be asked in full: the
 * counts are of a DOM a browser built from a database a run really wrote, and the hover
 * is CSS, which has no computed style anywhere else in this repository's suites.
 *
 * The `local` project alone collects it, for the same reason `intake` is local-only
 * until `SL6`: the deployed environment's storage has never been exercised and its AI
 * values are that slice's.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

/** The two CVs whose merge the fixtures stand for: one career, one month, two languages. */
const twoCvs = [`${documents}2026-08-30_cv_FR.pdf`, `${documents}2026-08-30_cv_EN.pdf`];

const who = { name: "Stefan Teofanovic", email: "profile-end-to-end@example.com" };

/** What `GET /api/intake/profile` answers, as much of it as this spec counts. */
type Item = {
  id: string;
  kind: string;
  lines: { id: string }[];
  children: Item[];
};

type Profile = {
  name: string | null;
  documents: number;
  summary: Item | null;
  identity: Item | null;
  experience: Item[];
  projects: Item[];
  groups: Item[];
  education: Item[];
};

test.afterAll(async () => {
  await forget();
});

test("the profile shows everything that was read, and each region lights alone", async ({
  browser,
}) => {
  const context = await signedIn(browser, who);
  const page = await context.newPage();

  // The documents first: a profile is what a run produced, so this spec produces one.
  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(twoCvs);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(2, {
    timeout: 30_000,
  });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();

  // What the interface answered, asked for through the same proxy the page uses.
  const answered = (await (await page.request.get("/api/intake/profile")).json()) as Profile;

  const projects = [
    ...answered.experience.flatMap((post) => post.children),
    ...answered.projects,
  ].filter((each) => each.kind === "project");
  const chips = [
    ...answered.groups.flatMap((group) => group.children),
    ...answered.experience.flatMap((post) => post.children.flatMap((child) => child.children)),
  ].filter((each) => each.kind === "entry");
  const lines = answered.experience.reduce((count, post) => count + post.lines.length, 0);

  // A count of nothing against nothing would pass every assertion below and prove
  // none of them: the run really did produce a profile, and this is what says so.
  expect(answered.experience.length).toBeGreaterThan(0);
  expect(chips.length).toBeGreaterThan(0);
  expect(lines).toBeGreaterThan(0);

  // Exhaustive: the DOM's count equals the interface's, for every kind (criterion 8).
  await expect(page.locator("[data-row=post]")).toHaveCount(answered.experience.length);
  await expect(page.locator("[data-row=line]")).toHaveCount(lines);
  await expect(page.locator("[data-row=project]")).toHaveCount(projects.length);
  await expect(page.locator("[data-row=group]")).toHaveCount(answered.groups.length);
  await expect(page.locator("[data-row=chip]")).toHaveCount(chips.length);
  await expect(page.locator("[data-row=diploma]")).toHaveCount(
    answered.education.filter((each) => each.kind === "education").length,
  );
  await expect(page.locator("[data-row=language]")).toHaveCount(
    answered.education.filter((each) => each.kind === "language").length,
  );
  await expect(page.getByText("more", { exact: false })).toHaveCount(0);

  // The bar says what it was read from, and the count is the interface's own.
  await expect(page.locator("profile-bar")).toContainText(
    `From ${answered.documents} documents, read today`,
  );

  /**
   * The hover, in a browser that has the stylesheet (criterion 10). Regions nest and
   * the pointer is over all of them at once, so `:hover:not(:has(.region:hover))` must
   * leave the post and the project dark while the chip is lit. This is the assertion
   * `:has` exists for, and jsdom can make none of it.
   */
  const chip = page.locator("[data-row=chip]").first();
  const post = page.locator("[data-row=post]").first();
  const dark = await post.evaluate((element) => window.getComputedStyle(element).boxShadow);
  await chip.hover();
  await expect
    .poll(async () => chip.evaluate((element) => window.getComputedStyle(element).boxShadow))
    .not.toBe(dark);
  expect(await post.evaluate((element) => window.getComputedStyle(element).boxShadow)).toBe(dark);

  await context.close();
});

test("below 1024 px the profile is one column, and the bar switches it", async ({ browser }) => {
  const context = await signedIn(browser, {
    ...who,
    email: "profile-one-column@example.com",
  });
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(twoCvs);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(2, {
    timeout: 30_000,
  });

  // The mockup's narrow viewport (criterion 7, the phone at 390).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");

  await expect(page.locator("profile-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Back to the chat" }).click();
  await expect(page.locator("profile-sheet")).toBeHidden();
  await page.getByRole("button", { name: "See my profile" }).click();
  await expect(page.locator("profile-sheet")).toBeVisible();

  await context.close();
});
