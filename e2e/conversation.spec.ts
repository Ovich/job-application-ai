import { fileURLToPath } from "node:url";
import { type BrowserContext, expect, test } from "@playwright/test";
import { apiUrl, payloadHashOf } from "./support/api";
import { forget, givenAReading, type Person, signedIn, type Where } from "./support/session";
import { postStream } from "./support/stream";

/**
 * Seam E: a conversation, stored and opened, walked for real (agent-consolidation
 * `SL2`, `S2.4`, `US8`), and seam A of `SL6`: the conversations routes, at whichever
 * address the project names.
 *
 * The first two cases read a real document through the page, which only a laptop can do
 * (`ID138`), so they skip themselves at the deployed address. The four after them give
 * the person a reading straight into that address's database (`givenAReading`, `ID212`)
 * and then ask only the API, so both projects run them (`ID178`, `ID213`): there, every
 * request crosses the distribution, origin access control and its payload hash, and the
 * function streaming its reply.
 */

const documents = fileURLToPath(new URL("../apps/api/tests/fixtures/documents/", import.meta.url));

const who = { name: "Stefan Teofanovic", email: "conversation-end-to-end@example.com" };

type Conversation = { id: string; entries: { position: number }[] };

/** Which address this run is against, and so which database the fixture writes to. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

const onlyOnALaptop = "a real document is read only by the dev server's paced double (ID138)";

// biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a hook asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
test.afterAll(async ({}, testInfo) => {
  await forget(addressOf(testInfo.project.name));
});

test("the opening lands on a first visit, and a reload shows it once", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "deployed", onlyOnALaptop);
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

/**
 * A free message, walked for real (agent-consolidation `SL3`, `US2`, `US3`): typed with the
 * first question open and nothing picked, its reply streamed by the paced mock as the
 * words `No pre generated text`, and both read back after a reload, after the opening.
 */
test("a free message and its streamed reply land, and a reload shows both after the opening", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "deployed", onlyOnALaptop);
  test.setTimeout(90_000);
  const context = await signedIn(browser, {
    name: "Stefan Teofanovic",
    email: "conversation-free-message@example.com",
  });
  const page = await context.newPage();

  await page.goto("/documents");
  await page.locator("input[type=file]").setInputFiles([`${documents}2026-08-30_cv_EN.pdf`]);
  await page.getByRole("button", { name: "Read my documents" }).click();
  await expect(page.locator("[data-row=document]").filter({ hasText: "read" })).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.goto("/profile");
  const assistant = page.locator("profile-assistant");
  await expect(assistant).toHaveAttribute("data-guide", "done");
  const count = (await assistant.locator("[data-part=count]").textContent())?.trim();

  const composer = assistant.locator("[data-part=composer]");
  await composer.fill("Which document did you read first?");
  await composer.press("Enter");

  const said = assistant.locator("[data-entry]");
  await expect(said.filter({ hasText: "Which document did you read first?" })).toHaveCount(1);
  await expect(said.filter({ hasText: "No pre generated text" })).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(assistant.locator("[data-part=count]")).toHaveText(count ?? "");

  await page.reload();
  await expect(assistant.locator("[data-part=opening]")).toHaveCount(1);
  await expect(said).toHaveText([/Which document did you read first\?/, /No pre generated text/]);

  const stored = (await (await page.request.get("/api/conversations/profile")).json()) as {
    id: string;
    entries: { position: number; author: string; parts: { text?: string }[] }[];
  };
  expect(
    stored.entries.map((entry) => [entry.position, entry.author, entry.parts.at(-1)?.text]),
  ).toEqual([
    [1, "assistant", expect.any(String)],
    [2, "person", "Which document did you read first?"],
    [3, "assistant", "No pre generated text"],
  ]);
});

/**
 * Seam A of `SL6`: the conversations routes, asked of both addresses. Every person here
 * has an address of this run's own, since the deployed environment is shared, and is
 * given a reading straight into that address's database rather than through the page.
 * Entries are read only through `GET`, never from the database.
 */
test.describe("the conversations routes, at this address", () => {
  type Stored = {
    id: string;
    entries: { position: number; author: string; parts: { text?: string }[] }[];
  };

  const path = "/api/conversations/profile";
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const person = (name: string): Person => ({
    name: "Stefan Teofanovic",
    email: `conversation-${name}-${run}@example.com`,
  });

  const opened = async (context: BrowserContext): Promise<Stored> => {
    const answer = await context.request.get(path);
    expect(answer.status()).toBe(200);
    return (await answer.json()) as Stored;
  };

  const said = (stored: Stored) =>
    stored.entries.map((entry) => [entry.position, entry.author, entry.parts.at(-1)?.text]);

  test("the opening is the first entry, and only once", async ({ browser }, testInfo) => {
    const at = addressOf(testInfo.project.name);
    const who = person("opening");
    const context = await signedIn(browser, who, at);

    const before = await context.request.get(path);
    expect(before.status()).toBe(409);

    await givenAReading(who, at);
    const first = await opened(context);
    expect(said(first)).toEqual([[1, "assistant", expect.any(String)]]);
    const again = await opened(context);
    expect(again.id).toBe(first.id);
    expect(again.entries).toEqual(first.entries);
    await context.close();
  });

  test("a message streams its reply and both are kept", async ({ browser }, testInfo) => {
    const at = addressOf(testInfo.project.name);
    const who = person("message");
    const context = await signedIn(browser, who, at);
    await givenAReading(who, at);
    await opened(context);

    const leaves = await postStream(
      context,
      apiUrl(testInfo.project.use.baseURL, `${path}/messages`),
      {
        text: "Which document did you read first?",
      },
    );
    expect(
      leaves
        .filter((leaf) => leaf.kind === "text")
        .map((leaf) => leaf.text)
        .join(""),
    ).toContain("No pre generated text");
    expect(leaves.at(-1)?.kind).toBe("done");

    expect(said(await opened(context))).toEqual([
      [1, "assistant", expect.any(String)],
      [2, "person", "Which document did you read first?"],
      [3, "assistant", "No pre generated text"],
    ]);
    await context.close();
  });

  test("a second person reads none of the first's", async ({ browser }, testInfo) => {
    const at = addressOf(testInfo.project.name);
    const first = person("first");
    const second = person("second");
    const firstContext = await signedIn(browser, first, at);
    const secondContext = await signedIn(browser, second, at);
    await givenAReading(first, at);
    await givenAReading(second, at);

    const theirs = await opened(firstContext);
    await postStream(firstContext, apiUrl(testInfo.project.use.baseURL, `${path}/messages`), {
      text: "Only mine to read.",
    });

    const mine = await opened(secondContext);
    expect(mine.id).not.toBe(theirs.id);
    expect(said(mine)).toEqual([[1, "assistant", expect.any(String)]]);
    await firstContext.close();
    await secondContext.close();
  });

  test("deleting the account takes the conversation", async ({ browser }, testInfo) => {
    const at = addressOf(testInfo.project.name);
    const who = person("deleted");
    const context = await signedIn(browser, who, at);
    await givenAReading(who, at);
    await opened(context);
    await postStream(context, apiUrl(testInfo.project.use.baseURL, `${path}/messages`), {
      text: "Forget me.",
    });

    // The library's own route, as the web app's client reaches it: the page's origin,
    // which the library demands of a request carrying a session cookie, and the payload
    // hash the deployed origin demands of a body.
    const body = "{}";
    const deleted = await context.request.post("/api/auth/delete-user", {
      headers: {
        origin: new URL(apiUrl(testInfo.project.use.baseURL, "/")).origin,
        "content-type": "application/json",
        "x-amz-content-sha256": await payloadHashOf(body),
      },
      data: body,
    });
    expect(deleted.status()).toBe(200);
    await context.close();

    const back = await signedIn(browser, who, at);
    await givenAReading(who, at);
    expect(said(await opened(back))).toEqual([[1, "assistant", expect.any(String)]]);
    await back.close();
  });
});
