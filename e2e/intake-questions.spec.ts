import { fileURLToPath } from "node:url";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { deletedThroughApp, forget, type Person, signedIn, type Where } from "./support/session";

/**
 * The person's path through the questions, walked for real (criterion 11, `US5`, `US6`,
 * `US7`).
 *
 * Read, land in the viewer, answer one with a choice, answer one in the person's own
 * words, skip one, reload and find the profile concerns still there. It is the one place the
 * whole of it can be asked at once: the concerns on the screen were written by routes a browser
 * called, into a database a run really wrote, and read back after a reload that kept
 * nothing in the page.
 *
 * Both projects collect it (agent-consolidation `SL9`, `ID224`), as `intake`: deployed, the
 * documents land in dev's bucket, and every person made here is deleted through the
 * account deletion route after the file, so their objects go with them.
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

/** A suffix of this run's own: the deployed environment is shared, and an address is unique. */
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const who = { name: "Stefan Teofanovic", email: `questions-end-to-end-${run}@example.com` };

/** Which address this run is against, and so which database the fixture writes to. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

/** Everyone this file signed in and did not delete through the page, by their context. */
const signedInHere: BrowserContext[] = [];

/** `person` signed in at this project's address, kept for the deletion after the file. */
const signedInAt = async (
  browser: Browser,
  person: Person,
  testInfo: TestInfo,
): Promise<BrowserContext> => {
  const context = await signedIn(browser, person, addressOf(testInfo.project.name));
  signedInHere.push(context);
  return context;
};

/**
 * The conversation's newest line is read, not hidden under the tool (agent-consolidation
 * `S8.4b`, `ID227`): the waiting line's box lies inside the visible area of the column that
 * scrolls it, and above the top of the tool dock.
 */
const waitingLineInView = async (page: Page): Promise<void> => {
  const waiting = page.locator("[data-part=waiting]");
  await expect(waiting).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      waiting.evaluate((line) => {
        let column = line.parentElement;
        while (column !== null && !/(auto|scroll)/.test(getComputedStyle(column).overflowY)) {
          column = column.parentElement;
        }
        const dock = document.querySelector("[data-part=dock]");
        if (column === null || dock === null) return "no scrolling column or no dock";
        const its = line.getBoundingClientRect();
        const seen = column.getBoundingClientRect();
        const top = dock.getBoundingClientRect().top;
        return its.top >= seen.top && its.bottom <= seen.bottom && its.bottom <= top
          ? "in view above the dock"
          : `line ${its.top}..${its.bottom}, column ${seen.top}..${seen.bottom}, dock top ${top}`;
      }),
    )
    .toBe("in view above the dock");
};

/**
 * The conversation opens on its latest exchange (agent-consolidation `S8.9`, `ID237`): the
 * foot of its newest line, the waiting line while a tool is active and the last message
 * otherwise, lies inside the visible area of the column that scrolls it.
 */
const newestLineInView = async (page: Page): Promise<void> => {
  await expect(page.locator("profile-assistant [data-msg]").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.querySelector("profile-assistant");
        const newest =
          host?.querySelector("[data-part=waiting]") ??
          Array.from(host?.querySelectorAll("[data-msg]") ?? []).at(-1) ??
          null;
        let column = newest?.parentElement ?? null;
        while (column !== null && !/(auto|scroll)/.test(getComputedStyle(column).overflowY)) {
          column = column.parentElement;
        }
        if (newest === null || column === null) return "no newest line or no scrolling column";
        const its = newest.getBoundingClientRect();
        const seen = column.getBoundingClientRect();
        return its.bottom > seen.top && its.bottom <= seen.bottom + 1
          ? "in view"
          : `line ${its.top}..${its.bottom}, column ${seen.top}..${seen.bottom}`;
      }),
    )
    .toBe("in view");
};

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

test("the assistant asks, the answers become profile concerns, and a reload still has them", async ({
  browser,
}, testInfo) => {
  // The wait below reads documents through the paced double and carries a timeout of
  // its own. A test may not outlive its own budget, so the budget has to be the
  // larger of the two: at Playwright's default 30s the wait was cut off at half its
  // allowance, and only on a runner slow enough to need it.
  test.setTimeout(120_000);
  const context = await signedInAt(browser, who, testInfo);
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(three);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(3, {
    timeout: 60_000,
  });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();

  // The assistant writes first and only then activates its tool (agent-consolidation
  // `S8.1`, `S8.2`): watched frame by frame in the page, no choice is offered while the
  // host's `data-guide` names a step still being performed.
  const offeredWhilePerforming = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let offered = 0;
        const look = (): void => {
          const step = document.querySelector("profile-assistant")?.getAttribute("data-guide");
          if (step === "done") {
            resolve(offered);
            return;
          }
          if (typeof step === "string" && step !== "activate") {
            offered += document.querySelectorAll("[data-action=alt]").length;
          }
          requestAnimationFrame(look);
        };
        look();
      }),
  );
  expect(offeredWhilePerforming).toBe(0);

  // The first question is open with no click at all, and the count is a count.
  const count = page.locator("[data-part=count]");
  await expect(page.locator("scope-tool")).toBeVisible();
  await waitingLineInView(page);
  await expect(count).toHaveText(/^0 of \d+ answered$/);
  await expect(page.locator("body")).not.toContainText("%");

  // The sheet is dimmed and the question's own region is the one that rose.
  await expect(page.locator("profile-sheet article")).toHaveAttribute("data-focused", "true");
  await expect(page.locator("[data-selected=true]")).toHaveCount(1);

  /** The concern the row a case picks would write, read off the row itself. */
  const firstLead = await page.locator("[data-part=lead]").textContent();
  const firstRow = page.locator("[data-action=alt]").first();
  const firstConcern = await firstRow.getAttribute("data-concern");
  expect(firstConcern).not.toBeNull();

  // One answered with a choice.
  await firstRow.click();
  await expect(firstRow).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^1 of \d+ answered$/);
  // The assistant acknowledges, names the next question and activates its tool, with the
  // line saying it waits for the person (`S8.3`, `ID218`).
  await waitingLineInView(page);
  await expect(page.locator("[data-action=alt]").first()).toBeVisible();
  await expect(page.locator("[data-part=lead]")).not.toHaveText(firstLead ?? "");

  // One answered in the person's own words: the question's last row, which is a pick that
  // carries words (plan ID205). Words with no row picked are a free message, and stay
  // covered by `e2e/conversation.spec.ts`.
  const ownWords = "I only ever read the dashboards, never set anything up";
  await page.locator("[data-action=alt]").last().click();
  await page.locator("[data-part=composer]").fill(ownWords);
  await page.locator("[data-part=send]").click();
  await expect(count).toHaveText(/^2 of \d+ answered$/);

  // One skipped, which the count says is for the builder and the next one opens.
  await page.locator("[data-action=skip]").click();
  await expect(count).toHaveText(/^2 of \d+ answered, 1 for the builder$/);
  await expect(page.locator("scope-tool")).toBeVisible();
  await waitingLineInView(page);

  // The concerns are on the sheet, as the check line under their items.
  await expect(
    page.locator("[data-part=concern]").filter({ hasText: firstConcern ?? "" }),
  ).toHaveCount(1);
  await expect(page.locator("[data-part=concern]").filter({ hasText: ownWords })).toHaveCount(1);

  // And a reload, which keeps nothing in the page, still has both of them.
  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  await expect(
    page.locator("[data-part=concern]").filter({ hasText: firstConcern ?? "" }),
  ).toHaveCount(1);
  await expect(page.locator("[data-part=concern]").filter({ hasText: ownWords })).toHaveCount(1);
  await expect(count).toHaveText(/^2 of \d+ answered, 1 for the builder$/);

  // A conversation with history opens on its latest exchange (agent-consolidation `S8.9`,
  // `ID237`). Below 1024 px the column is drawn hidden behind the sheet, and it is on its end
  // once shown.
  await newestLineInView(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  // The view toggle counts like the composer (`ID236`): the tool stays active across it.
  await page.getByRole("button", { name: "Back to the chat" }).click();
  await expect(page.locator("scope-tool")).toBeVisible();
  await expect(page.locator("[data-part=dock]")).toBeVisible();
  await waitingLineInView(page);
});

/**
 * The correction, the return and the deletion beside it (`SL5`, criteria 4, 7, 10 and
 * 12; `US8`, `US9`, `US11`).
 *
 * The same walk, carried past the questions: a chip nobody asked about, clicked and
 * spoken about in the person's own words, a reload that keeps nothing in the page, and
 * somebody else deleting their account through the gate while this profile is open.
 *
 * Both projects collect it, as the case above.
 */
test("a chip clicked, words about it in the conversation, and somebody else's deletion beside it", async ({
  browser,
}, testInfo) => {
  // The wait below reads documents through the paced double and carries a timeout of
  // its own. A test may not outlive its own budget, so the budget has to be the
  // larger of the two: at Playwright's default 30s the wait was cut off at half its
  // allowance, and only on a runner slow enough to need it.
  test.setTimeout(120_000);
  const context = await signedInAt(
    browser,
    { name: "Stefan Teofanovic", email: `clarification-end-to-end-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles(three);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(3, {
    timeout: 60_000,
  });

  await page.goto("/profile");
  await expect(page.locator("profile-sheet")).toBeVisible();
  // The opening is performed before the tool is activated (`S8.1`): a few seconds at the
  // application's pace, longer than an assertion's default wait on a slow runner.
  await expect(page.locator("profile-assistant")).toHaveAttribute("data-guide", "done", {
    timeout: 15_000,
  });
  await expect(page.locator("scope-tool")).toBeVisible();

  // A chip nobody asked about: no review flag on it, and no concern under it yet.
  const plain = page
    .locator("[data-row=chip]")
    .filter({ hasNot: page.locator("[data-part=ask], [data-part=concern]") })
    .first();
  const label = (await plain.textContent())?.trim() ?? "";
  expect(label).not.toBe("");

  // A press away closes the question the assistant activated and opens nothing on the chip
  // it landed on (agent-consolidation `S8.8`, `ID236`): no tool, and the sheet undimmed.
  await plain.click();
  await expect(page.locator("scope-tool")).toHaveCount(0);
  await expect(page.locator("profile-sheet article")).not.toHaveAttribute("data-focused", "true");

  // A second press opens the chip's own tool.
  await plain.click();

  // The tool proposes nothing at all, and only the prefix says what is in scope.
  await expect(page.locator("scope-tool [data-part=lead]")).toHaveText(
    "Tell me what I should know about it, in your own words.",
  );
  await expect(page.locator("[data-action=alt]")).toHaveCount(0);
  // The chip names the relation; the chip never carries the item, which is why a long
  // title cannot crowd the text bar beside it.
  await expect(page.locator("[data-part=what]")).toHaveText("Adjusting scope");

  const ownWords = "I only ever wrote the Dockerfiles, somebody else ran them";
  await page.locator("[data-part=composer]").fill(ownWords);
  await page.locator("[data-part=send]").click();

  /**
   * What the person wrote is a message naming the chip (agent-consolidation `S8.7`,
   * `ID233`): in the conversation with the chip's where above it, and no concern under it.
   */
  const wroteAboutTheChip = async (): Promise<void> => {
    const mine = page.locator("[data-msg=person]").filter({ hasText: ownWords });
    await expect(mine).toHaveCount(1, { timeout: 15_000 });
    await expect(mine.locator("[data-part=about]")).toHaveText(label);
    await expect(page.locator("[data-part=concern]").filter({ hasText: ownWords })).toHaveCount(0);
  };
  await wroteAboutTheChip();
  // The assistant is back on what still waits.
  await expect(page.locator("[data-action=alt]").first()).toBeVisible();

  // A second visit, which keeps nothing in the page: the profile, the words about the
  // chip, and the first question still waiting. No done state and no exit.
  await page.reload();
  await expect(page.locator("profile-sheet")).toBeVisible();
  await wroteAboutTheChip();
  // Performed again when the conversation still holds only its opening, shown at once
  // when it holds more (`S8.2`): either way the tool is active once the column is.
  await expect(page.locator("scope-tool")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("scope-tool")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("That is all I needed.");

  // Somebody else deletes their account through the gate, and this profile is untouched.
  // Not kept for the deletion after the file: this person deletes their own account below.
  const other = await signedIn(
    browser,
    { name: "Ben Seeker", email: `deleting-beside-${run}@example.com` },
    addressOf(testInfo.project.name),
  );
  const theirPage = await other.newPage();
  // `/documents`, not `/profile`, for the reason `auth.spec` already gives: this person has
  // handed nothing over, so the viewer sends them to the drop zone, and a redirect that
  // lands under the click throws away the menu it just opened. On a slow runner it landed
  // after the click, and the test waited its whole budget for a menu item that was never
  // coming. The shell, and its account menu, are the same on both pages.
  await theirPage.goto("/documents");
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
  await wroteAboutTheChip();

  await other.close();
});
