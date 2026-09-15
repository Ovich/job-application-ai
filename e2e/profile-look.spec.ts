import { fileURLToPath } from "node:url";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { deletedThroughApp, forget, signedIn } from "./support/session";

/**
 * The profile page's look, compared pixel for pixel with the images captured at `main`
 * before the assistant architecture migration (assistant-architecture `SL1`, `SL10`,
 * `ID240`, `ID241`, D19).
 *
 * A walk that reaches each state on its visible text and compares the viewport, at 1440 and
 * 390 px, with `profile-look/<state>-<width>-<platform>.png`. Local only: dev holds other
 * people's data.
 *
 * The documents are read through the page, as `intake-questions.spec` reads them: a reading
 * given straight into the database holds one item and no question, and the pick, the skip
 * and the tool need questions. The clock is frozen at the run's start before the page
 * loads, and a day later for the returning visit.
 *
 * **What is masked, and only that:** every `ago` line (`<time>`) and the sheet's
 * `From 3 documents, read on <date>` line. Both say the day the run happens, which no image
 * captured on another day can hold; every other pixel is compared.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

const three = [
  `${documents}2026-08-30_cv_FR.pdf`,
  `${documents}leCVWeb.docx`,
  `${documents}CV-2025.pdf`,
];

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const who = { name: "Stefan Teofanovic", email: `profile-look-${run}@example.com` };

const wide = { width: 1440, height: 900 };
const narrow = { width: 390, height: 844 };

const signedInHere: BrowserContext[] = [];

test.afterAll(async () => {
  for (const context of signedInHere.splice(0)) {
    await deletedThroughApp(context);
    await context.close();
  }
  await forget();
});

/** The lines that say the day the run happens: every `ago`, and when the documents were read. */
const dated = (page: Page) => [page.locator("time"), page.locator("profile-bar small")];

/** The current state at `width`, the pointer parked where it lights nothing, as SL1 took it. */
const looks = async (page: Page, state: string, size: { width: number; height: number }) => {
  await page.setViewportSize(size);
  await page.mouse.move(size.width - 1, size.height - 1);
  // Soft, so one run names every state that differs rather than the first.
  await expect.soft(page).toHaveScreenshot(`${state}-${size.width}.png`, {
    animations: "disabled",
    caret: "hide",
    mask: dated(page),
    timeout: 15_000,
  });
};

/** The state at both widths, the walk carried on at the wide one. */
const both = async (page: Page, state: string) => {
  await looks(page, state, wide);
  await looks(page, state, narrow);
  await page.setViewportSize(wide);
};

/** The assistant has landed every step of its performance. */
const performed = async (page: Page) => {
  await expect(page.locator("profile-assistant")).toHaveAttribute("data-guide", "done", {
    timeout: 30_000,
  });
};

test("the profile page's states look as they did before the migration, at 1440 and 390 px", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const start = new Date();

  const context = await signedIn(browser, who);
  signedInHere.push(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(start);
  await page.setViewportSize(wide);

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(three);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(3, { timeout: 90_000 });

  // The first visit ends with the first question's tool active.
  await page.goto("/profile");
  await performed(page);
  await expect(page.locator("scope-tool")).toBeVisible();
  await expect(page.locator("[data-part=waiting]")).toBeVisible();
  await both(page, "first-visit-tool-active");

  // A row picked and saved: acknowledged, and the next question active.
  const count = page.locator("[data-part=count]");
  await page.locator("[data-action=alt]").first().click();
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^1 of \d+ answered$/);
  await performed(page);
  await expect(page.locator("[data-part=waiting]")).toBeVisible({ timeout: 15_000 });
  await both(page, "after-pick");

  // A question skipped.
  await page.locator("[data-action=skip]").click();
  await expect(count).toHaveText(/^1 of \d+ answered, 1 for the builder$/);
  await performed(page);
  await expect(page.locator("[data-part=waiting]")).toBeVisible({ timeout: 15_000 });
  await both(page, "after-skip");

  // A line pressed: the first press closes the active tool, the second opens the line's own.
  const line = page.locator("[data-row=line]").first();
  await line.click();
  await expect(page.locator("scope-tool")).toHaveCount(0);
  await line.click();
  await expect(page.locator("scope-tool [data-part=lead]")).toHaveText(
    "Tell me what I should know about it, in your own words.",
  );
  await both(page, "clarification");

  // Escape, then the add-documents modal.
  await page.keyboard.press("Escape");
  await expect(page.locator("scope-tool")).toHaveCount(0);
  await page.getByRole("button", { name: "Add documents" }).click();
  await expect(page.getByRole("dialog", { name: "Add documents" })).toBeVisible();
  await both(page, "add-documents");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add documents" })).toHaveCount(0);

  // Below 1024 px, the chat shown by the toggle. The toggle exists only there.
  await page.setViewportSize(narrow);
  await page.getByRole("button", { name: "Back to the chat" }).click();
  await expect(page.locator("[data-part=composer]")).toBeVisible();
  await looks(page, "chat-view", narrow);

  // A day later, a returning visit: the sheet at 1440, and the chat below 1024 px.
  await page.clock.setFixedTime(new Date(start.getTime() + 24 * 60 * 60 * 1000));
  await page.setViewportSize(wide);
  await page.reload();
  await expect(page.getByText(/^Welcome back\./)).toBeVisible({ timeout: 30_000 });
  // A conversation with history lands every step at once, and names no guide step.
  await expect(page.locator("[data-part=waiting]")).toBeVisible({ timeout: 15_000 });
  await looks(page, "returning", wide);
  await page.setViewportSize(narrow);
  await page.getByRole("button", { name: "Back to the chat" }).click();
  await expect(page.locator("[data-part=composer]")).toBeVisible();
  await looks(page, "returning", narrow);
});
