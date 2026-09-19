import { randomUUID } from "node:crypto";
import { user } from "@app/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

/**
 * Seam C: `lib/conversation`, `open` · `entries` · `append` (`S2.1`, `US5`, `US8`).
 *
 * Behind it: PGlite with the real migrations (`tests/support/database.ts`), so migration
 * `0004` is what these cases meet. The seam stays inside the module: every answer is
 * read back through `entries()`, never by selecting from the two tables. A person is a
 * `user` row written here, because who a person is is the library's and not this
 * module's; deleting that row is how an account's deletion reaches the conversation.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { testDb } = await import("../../support/database");
const { append, contextWindow, entries, open, setContextWindow } =
  await import("../../../src/lib/conversation");

/** A person, as the library would have saved one. */
const aPerson = async () => {
  const id = randomUUID();
  await testDb.insert(user).values({ id, name: "Someone", email: `${id}@example.com` });
  return { id };
};

const opening = [
  { kind: "text" as const, text: "I read your 2 documents.", scripted: true as const },
  { kind: "text" as const, text: "First, Java.", scripted: true as const },
];

/** An opening that says whether it was asked for, so a case can tell creation from reading. */
const counted = () => {
  const calls = { count: 0 };
  return {
    calls,
    opening: async () => {
      calls.count += 1;
      return opening;
    },
  };
};

describe("opening a conversation (US8)", () => {
  it("creates it with the opening as entry 1, written by the assistant", async () => {
    const person = await aPerson();

    const conversation = await open(person, "profile", null, async () => opening);

    const [first, ...rest] = await entries(conversation);
    expect(rest).toEqual([]);
    expect(first?.position).toBe(1);
    expect(first?.author).toBe("assistant");
    expect(first?.parts).toEqual(opening);
    expect(conversation).toMatchObject({ userId: person.id, assistant: "profile", subject: null });
  });

  it("opens the same conversation a second time, still with one entry, and asks for no opening", async () => {
    const person = await aPerson();
    const { calls, opening: once } = counted();

    const first = await open(person, "profile", null, once);
    const second = await open(person, "profile", null, once);

    expect(second.id).toBe(first.id);
    expect(await entries(second)).toHaveLength(1);
    expect(calls.count).toBe(1);
  });

  it("keeps two subjects of one assistant as two conversations", async () => {
    const person = await aPerson();

    const cv = await open(person, "cv", "application-1", async () => opening);
    const other = await open(person, "cv", "application-2", async () => opening);

    expect(other.id).not.toBe(cv.id);
    expect(await entries(cv)).toHaveLength(1);
    expect(await entries(other)).toHaveLength(1);
  });

  it("refuses an opening whose parts are not parts, and writes nothing", async () => {
    const person = await aPerson();

    await expect(
      open(person, "profile", null, async () => [{ kind: "text" } as never]),
    ).rejects.toThrow();

    const { calls, opening: again } = counted();
    await open(person, "profile", null, again);
    expect(calls.count).toBe(1);
  });
});

describe("appending to a conversation (S2.1)", () => {
  it("writes the next entry at position 2, and its parts read back equal", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);
    const said = [{ kind: "text" as const, text: "I ran the services, not the cluster." }];

    const written = await testDb.transaction((tx) => append(tx, conversation, "person", said));

    expect(written.position).toBe(2);
    const [, second] = await entries(conversation);
    expect(second).toMatchObject({ position: 2, author: "person", parts: said });
  });
});

describe("a notice under the system author (SL8, D34)", () => {
  it("stores a system entry of one notice part, and reads it back as written", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);
    const said = [{ kind: "notice" as const, text: "Your profile was updated." }];

    const written = await testDb.transaction((tx) => append(tx, conversation, "system", said));

    expect(written).toMatchObject({ position: 2, author: "system", parts: said });
    const [, second] = await entries(conversation);
    expect(second).toMatchObject({ position: 2, author: "system", parts: said });
  });

  it("refuses a notice with no text, and writes nothing", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);

    await expect(
      testDb.transaction((tx) =>
        append(tx, conversation, "system", [{ kind: "notice", text: "" }] as never),
      ),
    ).rejects.toThrow();
    expect(await entries(conversation)).toHaveLength(1);
  });
});

describe("the agent's context window (SL9, D36)", () => {
  it("has none until one is written: both columns are empty on a new conversation", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);

    expect(await contextWindow(conversation)).toEqual({});
  });

  it("reads back what the caller's transaction wrote, and a later write replaces it", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);

    await testDb.transaction((tx) => setContextWindow(tx, conversation, { cleared: 4 }));
    expect(await contextWindow(conversation)).toEqual({ cleared: 4 });

    await testDb.transaction((tx) => setContextWindow(tx, conversation, { cut: 7, cleared: 6 }));
    expect(await contextWindow(conversation)).toEqual({ cut: 7, cleared: 6 });
  });

  it("writes nothing when the caller's transaction rolls back", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);

    await expect(
      testDb.transaction(async (tx) => {
        await setContextWindow(tx, conversation, { cut: 3 });
        throw new Error("the step failed");
      }),
    ).rejects.toThrow("the step failed");
    expect(await contextWindow(conversation)).toEqual({});
  });

  it("is the conversation's own: another conversation's window is untouched", async () => {
    const person = await aPerson();
    const one = await open(person, "profile", null, async () => opening);
    const other = await open(person, "profile", "another", async () => opening);

    await testDb.transaction((tx) => setContextWindow(tx, one, { cut: 2 }));

    expect(await contextWindow(other)).toEqual({});
  });
});

describe("deleting the account (US5)", () => {
  it("takes the conversation and its entries, so opening again creates it afresh", async () => {
    const person = await aPerson();
    const conversation = await open(person, "profile", null, async () => opening);
    await testDb.transaction((tx) =>
      append(tx, conversation, "person", [{ kind: "text", text: "Something." }]),
    );

    await testDb.delete(user).where(eq(user.id, person.id));

    expect(await entries(conversation)).toEqual([]);
    await testDb.insert(user).values({ id: person.id, name: "Again", email: `${person.id}@x.ch` });
    const afresh = await open(person, "profile", null, async () => opening);
    expect(afresh.id).not.toBe(conversation.id);
    expect(await entries(afresh)).toHaveLength(1);
  });
});
