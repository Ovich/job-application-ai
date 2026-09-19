import { type BrowserContext, expect, test } from "@playwright/test";
import { apiUrl } from "./support/api";
import {
  deletedThroughApp,
  forget,
  givenAReading,
  type Person,
  signedIn,
  type Where,
} from "./support/session";
import { postStream } from "./support/stream";

/**
 * Seam A of `SL6`: the conversations routes, at whichever address the project names
 * (agent-consolidation `SL2`, `S2.4`, `US8`).
 *
 * Every person here is given a reading straight into that address's database
 * (`givenAReading`, `ID212`) and then only the API is asked (`ID178`, `ID213`): there,
 * every request crosses the distribution, origin access control and its payload hash, and
 * the function streaming its reply.
 *
 * The two cases that read a document through the page and then walked the assistant column
 * on `/profile` left this file at product-flow-rework `S2.1`: the column is off that route
 * (`ID331`), so they are parked whole in `conversation-screen.spec.ts`, out of collection
 * and owed to `profile-assistant`. What they proved about the routes is proved below.
 */

/** A suffix of this run's own: the deployed environment is shared, and an address is unique. */
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Which address this run is against, and so which database the fixture writes to. */
const addressOf = (project: string): Where => (project === "deployed" ? "deployed" : "local");

// biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a hook asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
test.afterAll(async ({}, testInfo) => {
  await forget(addressOf(testInfo.project.name));
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

    const deleted = await deletedThroughApp(context, at);
    expect(deleted.status()).toBe(200);
    await context.close();

    const back = await signedIn(browser, who, at);
    await givenAReading(who, at);
    expect(said(await opened(back))).toEqual([[1, "assistant", expect.any(String)]]);
    await back.close();
  });
});
