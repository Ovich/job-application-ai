import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { forget, signedIn } from "./support/session";

/**
 * The person's path through the questions, walked for real (criterion 11, `US5`, `US6`,
 * `US7`).
 *
 * Read, land in the viewer, answer one with a choice, answer one in the person's own
 * words, skip one, reload and find the rules still there. It is the one place the whole
 * of it can be asked at once: the rules on the screen were written by routes a browser
 * called, into a database a run really wrote, and read back after a reload that kept
 * nothing in the page.
 *
 * The `local` project alone collects it, as `intake` and `profile` are, until `SL6`.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

/**
 * The three documents the shipped questions case stands for: the generic French CV, the
 * 2022 archive and the 2025 one. Their disagreement is the conflict, and what they carry
 * with no stated part is the scope.
 */
const three = [
  `${documents}2026-08-30_cv_FR.pdf`,
  `${documents}leCVWeb.docx`,
  `${documents}CV-2025.pdf`,
];

const who = { name: "Stefan Teofanovic", email: "questions-end-to-end@example.com" };

test.afterAll(async () => {
  await forget();
});

test("the assistant asks, the answers become rules, and a reload still has them", async ({
  browser,
}) => {
  const context = await signedIn(browser, who);
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(three);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(3, {
    timeout: 60_000,
  });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();

  // The first question is open with no click at all, and the count is a count.
  const count = page.locator("[data-part=count]");
  await expect(page.locator("scope-tool")).toBeVisible();
  await expect(count).toHaveText(/^0 of \d+ answered$/);
  await expect(page.locator("body")).not.toContainText("%");

  // The sheet is dimmed and the question's own region is the one that rose.
  await expect(page.locator("profile-sheet article")).toHaveAttribute("data-focused", "true");
  await expect(page.locator("[data-selected=true]")).toHaveCount(1);

  /** The rule the row a case picks would write, read off the row itself. */
  const firstLead = await page.locator("[data-part=lead]").textContent();
  const firstRow = page.locator("[data-action=alt]").first();
  const firstRule = await firstRow.getAttribute("data-rule");
  expect(firstRule).not.toBeNull();

  // One answered with a choice.
  await firstRow.click();
  await expect(firstRow).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^1 of \d+ answered$/);
  await expect(page.locator("[data-part=lead]")).not.toHaveText(firstLead ?? "");

  // One answered in the person's own words, with nothing picked at all.
  const ownWords = "I only ever read the dashboards, never set anything up";
  await page.locator("[data-part=composer]").fill(ownWords);
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^2 of \d+ answered$/);

  // One skipped, which the count says is for the builder and the next one opens.
  await page.locator("[data-action=skip]").click();
  await expect(count).toHaveText(/^2 of \d+ answered, 1 for the builder$/);
  await expect(page.locator("scope-tool")).toBeVisible();

  // The rules are on the sheet, as the check line under their items.
  await expect(page.locator("[data-part=rule]").filter({ hasText: firstRule ?? "" })).toHaveCount(
    1,
  );
  await expect(page.locator("[data-part=rule]").filter({ hasText: ownWords })).toHaveCount(1);

  // And a reload, which keeps nothing in the page, still has both of them.
  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(page.locator("[data-part=rule]").filter({ hasText: firstRule ?? "" })).toHaveCount(
    1,
  );
  await expect(page.locator("[data-part=rule]").filter({ hasText: ownWords })).toHaveCount(1);
  await expect(count).toHaveText(/^2 of \d+ answered, 1 for the builder$/);

  await context.close();
});

/**
 * The correction, the return and the deletion beside it (`SL5`, criteria 4, 7, 10 and
 * 12; `US8`, `US9`, `US11`).
 *
 * The same walk, carried past the questions: a chip nobody asked about, clicked and
 * spoken about in the person's own words, a reload that keeps nothing in the page, and
 * somebody else deleting their account through the gate while this profile is open.
 *
 * The `local` project alone collects it, as `intake` and `profile` are, until `SL6`.
 */
test("a chip clicked, a rule written on it, and somebody else's deletion beside it", async ({
  browser,
}) => {
  const context = await signedIn(browser, {
    name: "Stefan Teofanovic",
    email: "clarification-end-to-end@example.com",
  });
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(three);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(3, {
    timeout: 60_000,
  });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(page.locator("scope-tool")).toBeVisible();

  // A chip nobody asked about: no mark on it, and no rule under it yet.
  const plain = page
    .locator("[data-row=chip]")
    .filter({ hasNot: page.locator("[data-part=ask], [data-part=rule]") })
    .first();
  const label = (await plain.textContent())?.trim() ?? "";
  expect(label).not.toBe("");

  await plain.click();

  // The tool proposes nothing at all, and only the prefix says what is in scope.
  await expect(page.locator("scope-tool [data-part=lead]")).toHaveText(
    "Tell me what I should know about it, in your own words.",
  );
  await expect(page.locator("[data-action=alt]")).toHaveCount(0);
  await expect(page.locator("[data-part=what]")).toHaveText(`Scope · ${label}`);

  const ownWords = "I only ever wrote the Dockerfiles, somebody else ran them";
  await page.locator("[data-part=composer]").fill(ownWords);
  await page.locator("[data-part=send]").click();

  // The check line is under that chip, and the assistant is back on what still waits.
  await expect(page.locator("[data-part=rule]").filter({ hasText: ownWords })).toHaveCount(1);
  await expect(page.locator("[data-action=alt]").first()).toBeVisible();

  // A second visit, which keeps nothing in the page: the profile, the rule, and the
  // first question still waiting. No done state and no exit.
  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(page.locator("[data-part=rule]").filter({ hasText: ownWords })).toHaveCount(1);
  await expect(page.locator("scope-tool")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("That is all I needed.");

  // Somebody else deletes their account through the gate, and this profile is untouched.
  const other = await signedIn(browser, {
    name: "Ben Seeker",
    email: `deleting-beside-${Date.now()}@example.com`,
  });
  const theirPage = await other.newPage();
  await theirPage.goto("/profile");
  await theirPage.getByRole("button", { name: "Your account" }).click();
  await theirPage.getByRole("menuitem", { name: "Delete my account" }).click();
  const gate = theirPage.getByRole("dialog", { name: "Delete your account?" });
  await gate.getByRole("button", { name: "Acknowledge" }).click();
  const code = (await gate.getByText(/^\s*[A-Z0-9]{8}\s*$/).textContent())?.trim() ?? "";
  await gate.getByRole("textbox").fill(code);
  await gate.getByRole("button", { name: "Delete account" }).click();
  await theirPage.waitForURL((url) => url.pathname === "/" && url.searchParams.has("deleted"));

  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(page.locator("[data-part=rule]").filter({ hasText: ownWords })).toHaveCount(1);

  await other.close();
  await context.close();
});
