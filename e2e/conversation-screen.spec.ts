import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type TestInfo, test } from "@playwright/test";
import {
  deletedThroughApp,
  forget,
  givenAReading,
  type Person,
  signedIn,
  type Where,
} from "./support/session";

/**
 * **Out of collection since product-flow-rework `S2.1`, and owed to `profile-assistant`.**
 *
 * The two screen cases of `conversation.spec.ts`, lifted out of it whole. Both open
 * `/profile` and read the assistant column on it: the opening that lands on a first visit,
 * and a pick, a free message and its streamed reply staying in order after a reload. The
 * assistant left the intake (`ID331`), so there is no column at that route to walk — but
 * these are the walks `profile-assistant` will want the day it comes back (`ID330`), so
 * they stay in the tree, named by neither project in `playwright.config.ts`, rather than
 * being deleted or skipped. The routes they exercised are still walked, at both addresses,
 * by what stayed in `conversation.spec.ts`.
 *
 * Whoever rebuilds that slot points these at the screen it has and names this file in the
 * projects that should collect it.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

/** A suffix of this run's own: the deployed environment is shared, and an address is unique. */
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Conversation = { id: string; entries: { position: number }[] };

/** Which address this run is against, and so which database the fixture writes to. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

/** Everyone these cases signed in, by the context carrying their session. */
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

test("the opening lands on a first visit, and a reload shows it once", async ({
  browser,
}, testInfo) => {
  // The reading below goes through the paced double and waits on it; the test's own
  // budget must be the larger of the two, as `profile.spec.ts` says of its own.
  test.setTimeout(90_000);
  const context = await signedInAt(
    browser,
    { name: "Stefan Teofanovic", email: `conversation-end-to-end-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([`${documents}2026-08-30_cv_EN.pdf`]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.goto("/profile");
  const opening = page.locator("profile-assistant [data-part=opening]");
  await expect(opening).toContainText("I read your 1 document.");
  await expect(page.locator("profile-assistant")).toHaveAttribute("data-guide", "done");
  const landed = (await opening.textContent())?.trim() ?? "";

  const first = (await (
    await page.request.get("/api/conversations/profile")
  ).json()) as Conversation;
  expect(first.entries).toHaveLength(1);

  await page.reload();
  await expect(opening).toHaveCount(1);
  await expect(opening).toHaveText(landed);
  await expect(page.getByText(landed, { exact: true })).toHaveCount(1);

  const again = (await (
    await page.request.get("/api/conversations/profile")
  ).json()) as Conversation;
  expect(again.id).toBe(first.id);
  expect(again.entries).toHaveLength(1);
});

/**
 * The slot's check, automated (agent-consolidation `SL3`, `US2`, `US3`; `SL9`, `S9.3`,
 * `ID225`): the first question answered by a pick, then a free message typed with the next
 * question open and nothing picked, its reply streamed by the mock as the words
 * `No pre generated text`, and after a reload the opening, the answer with its question
 * and the options offered, the message and the reply, in that order. A second person, with
 * a reading of their own, finds none of it.
 */
test("a pick, then a free message and its streamed reply, stay in order after the opening; a second person sees none of it", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const at = addressOf(testInfo.project.name);
  const context = await signedInAt(
    browser,
    { name: "Stefan Teofanovic", email: `conversation-free-message-${run}@example.com` },
    testInfo,
  );
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([`${documents}2026-08-30_cv_EN.pdf`]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(
    page.locator("[data-row=document]").filter({ has: page.getByText("read", { exact: true }) }),
  ).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.goto("/profile");
  const assistant = page.locator("profile-assistant");
  const column = assistant.locator("assistant-conversation");
  await expect(assistant).toHaveAttribute("data-guide", "done", { timeout: 15_000 });

  // The first question, answered by a pick: what was asked and every option offered,
  // read off the tool before the row is picked.
  const tool = page.locator("scope-tool");
  const lead = (await tool.locator("[data-part=lead]").textContent())?.trim() ?? "";
  const offered = (await tool.locator("[data-action=alt] [data-part=label]").allTextContents()).map(
    (label) => label.trim(),
  );
  const label = offered[0] ?? "";
  expect(lead).not.toBe("");
  expect(label).not.toBe("");
  await tool.locator("[data-action=alt]").first().click();
  await page.locator("[data-part=send]").click();
  const count = assistant.locator("[data-part=count]");
  // The count follows the agent's whole reply since D31; on a cold Lambda that is past the
  // default five seconds, so it waits as its neighbours do.
  await expect(count).toHaveText(/^1 of \d+ answered$/, { timeout: 30_000 });
  // The answer is a message to the agent (D31, `ID291`): its reply is the newest entry.
  const entries = column.locator("[data-entry]");
  await expect(entries.last()).toHaveAttribute("data-msg", "assistant", { timeout: 30_000 });
  // The preset's first pick has a written answer (`ID292`); the free message below has none.
  await expect(entries.last()).toContainText("Java on the CIIP platform");
  // The answer is a chain (D33, D37): the whole profile read first, drawn as one quiet line
  // before the reply, never its JSON.
  const readLine = column.locator("[data-part=read]");
  await expect(readLine).toHaveText(["Read your profile"]);
  await expect(column).not.toContainText('"items"');
  await expect(page.locator("[data-part=waiting]")).toBeVisible({ timeout: 15_000 });
  const answeredCount = (await count.textContent())?.trim() ?? "";

  // Then a free message, with the next question open and nothing picked.
  const message = "Which document did you read first?";
  const composer = assistant.locator("[data-part=composer]");
  await composer.fill(message);
  await composer.press("Enter");

  const said = column.locator("[data-entry]");
  await expect(said.filter({ hasText: message })).toHaveCount(1);
  // The message's reply is the one placeholder (the pick's is written): waiting for it keeps
  // the reload below from racing the run that stores it.
  await expect(said.filter({ hasText: "No pre generated text" })).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(count).toHaveText(answeredCount);

  // A reload keeps nothing in the page: what is there is what was stored.
  await page.reload();
  const opening = column.locator("[data-part=opening]");
  await expect(opening).toHaveCount(1);
  const answered = column.locator("[data-part=answered]");
  await expect(answered).toHaveCount(1);
  await expect(answered.locator("[data-part=asked]")).toContainText(lead);
  await expect(answered.locator("[data-part=picked]")).toHaveText(label);
  const typed = said.filter({ hasText: message });
  await expect(typed).toHaveCount(1);
  const reply = said.filter({ hasText: "No pre generated text" }).last();
  await expect(reply).toBeVisible();
  // The read is stored, and drawn again as the same one line.
  await expect(readLine).toHaveText(["Read your profile"]);

  const inOrder = await page.evaluate(
    (drawn) =>
      drawn.every(
        (node, n) =>
          n === 0 ||
          (drawn[n - 1] as Node).compareDocumentPosition(node as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    [
      await opening.elementHandle(),
      await answered.elementHandle(),
      await readLine.elementHandle(),
      await entries.filter({ hasText: "Java on the CIIP platform" }).elementHandle(),
      await typed.elementHandle(),
      await reply.elementHandle(),
    ],
  );
  expect(inOrder).toBe(true);

  // The answer is stored with its question and every option offered, read back as this
  // person through the route.
  const stored = (await (await page.request.get("/api/conversations/profile")).json()) as {
    id: string;
    entries: {
      position: number;
      author: string;
      parts: {
        kind: string;
        text?: string;
        lead?: string;
        options?: { id: string; label: string }[];
        picked?: string | null;
      }[];
    }[];
  };
  const kinds = stored.entries.map((entry) => entry.parts.at(-1));
  const answer = kinds.findIndex((part) => part?.kind === "question_answered");
  const asked = kinds[answer];
  expect(stored.entries[0]?.author).toBe("assistant");
  expect(answer).toBeGreaterThan(0);
  expect(asked?.lead).toBe(lead);
  expect(asked?.options?.map((option) => option.label)).toEqual(offered);
  expect(asked?.options?.find((option) => option.id === asked.picked)?.label).toBe(label);
  const typedAt = kinds.findIndex((part) => part?.kind === "text" && part.text === message);
  expect(typedAt).toBeGreaterThan(answer);
  expect(stored.entries[typedAt]?.author).toBe("person");
  expect(stored.entries.at(-1)?.author).toBe("assistant");
  expect(kinds.at(-1)?.text).toBe("No pre generated text");
  expect(stored.entries.length - 1).toBeGreaterThan(typedAt);

  // A second person, with a reading of their own, finds none of the first's.
  const second = { name: "Ben Seeker", email: `conversation-screen-second-${run}@example.com` };
  const theirs = await signedInAt(browser, second, testInfo);
  await givenAReading(second, at);
  const theirPage = await theirs.newPage();
  await theirPage.goto("/profile");
  const theirColumn = theirPage.locator("profile-assistant assistant-conversation");
  await expect(theirColumn.locator("[data-part=opening]")).toHaveCount(1, { timeout: 15_000 });
  await expect(theirColumn).not.toContainText(message);
  await expect(theirColumn.locator("[data-part=answered]")).toHaveCount(0);
  const their = (await (
    await theirPage.request.get("/api/conversations/profile")
  ).json()) as Conversation;
  expect(their.id).not.toBe(stored.id);
  expect(their.entries.map((entry) => entry.position)).toEqual([1]);
});
