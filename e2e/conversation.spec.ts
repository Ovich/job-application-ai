import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { forget, signedIn } from "./support/session";

/**
 * Seam E: a conversation, stored and opened, walked for real (agent-consolidation
 * `SL2`, `S2.4`, `US8`).
 *
 * Read one document, open the profile, watch the opening land; reload, and find it there
 * once. It is the one place the whole of it is asked at once: the opening a browser draws
 * after the reload was written by the route on the first visit, into the database the dev
 * server really runs on, and read back by a page that kept nothing.
 *
 * The `local` project alone collects it until `SL6` (`ID178`).
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

const who = { name: "Stefan Teofanovic", email: "conversation-end-to-end@example.com" };

type Conversation = { id: string; entries: { position: number }[] };

test.afterAll(async () => {
  await forget();
});

test("the opening lands on a first visit, and a reload shows it once", async ({ browser }) => {
  // The reading below goes through the paced double and waits on it; the test's own
  // budget must be the larger of the two, as `profile.spec.ts` says of its own.
  test.setTimeout(90_000);
  const context = await signedIn(browser, who);
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([`${documents}2026-08-30_cv_EN.pdf`]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(1, {
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
