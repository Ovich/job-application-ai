import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Support from "../support/intake";
import { subjectAt } from "../support/providers";
import { localStorageIn } from "../support/storage";

/**
 * Seam B: `routes/conversations`, `POST /:assistant/actions/:action`, with the profile
 * assistant's `answer_question` and `skip_question` (criteria 6, 7, 8; D9). Until `SL7` these
 * cases drove `POST /api/intake/questions/:id/answer`; the action is where that behaviour lives.
 *
 * Behind the seam: PGlite, and the same recorded cases seam A drives. The seam is the
 * route, and **every answer is read back through `GET /profile`** and the conversation's
 * own `GET` — never by selecting from the concern or the question table, because the one
 * thing criterion 7 is about is that two rows survive, and a select would prove that while
 * the screen showed one.
 *
 * Not past it: what the builder later does with a profile concern.
 */

const objects = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("../../src/lib/db", async () => ({
  db: (await import("../support/database")).testDb,
}));

vi.mock("../../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/storage")>()),
  get storage() {
    return objects.storage;
  },
}));

vi.mock("../../src/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/ai")>();
  const { aiThroughTheApp, chatModelThroughTheApp } = await import("../support/ai");
  const ai = aiThroughTheApp();
  return {
    ...real,
    ask: ai.ask,
    askStreaming: ai.askStreaming,
    askFor: ai.askFor,
    chatModel: () => chatModelThroughTheApp(),
  };
});

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
const { forgetRequests } = await import("../support/ai");
const { itemNamed } = await import("../support/intake");

let storage: ReturnType<typeof localStorageIn>;

beforeEach(() => {
  storage = localStorageIn();
  objects.storage = storage;
  forgetRequests();
});

const signedIn = async (email: string) => {
  const response = await signInThrough("google", {
    subject: subjectAt("google", email),
    name: "Someone Seeking",
    email,
    emailVerified: true,
  });
  const user = await signedInAs(response);
  if (user === null) throw new Error(`the sign-in for ${email} produced no session`);
  vi.unstubAllGlobals();
  return { id: user.id, cookie: cookiesSetBy(response) };
};

const three = [
  theSet.cvFrench.filename,
  theSet.cvWord2022.filename,
  theSet.cv2025.filename,
] as const;

const profileOf = async (cookie: string): Promise<Support.ProfileAnswer> =>
  (await (await app.request("/api/intake/profile", { headers: { cookie } })).json()) as never;

/** A person whose run has left them the four questions the shipped case proposes. */
const asked = async (email: string) => {
  const person = await signedIn(email);
  // The bytes go in with the rows: the reading turns each file into text itself before
  // it asks anything, so a run over rows with no objects behind them reads nothing
  // (`ID157`).
  await documentsFor(person.id, three, storage);
  await (
    await app.request("/api/intake/read", { method: "POST", headers: { cookie: person.cookie } })
  ).text();
  return { ...person, profile: await profileOf(person.cookie) };
};

const act = (cookie: string, action: string, input: unknown, assistant = "profile") =>
  app.request(`/api/conversations/${assistant}/actions/${action}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(input),
  });

const answer = (
  cookie: string,
  questionId: string,
  said: { optionId?: string | undefined; words?: string | undefined },
) => act(cookie, "answer_question", { questionId, ...said });

const skip = (cookie: string, questionId: string) => act(cookie, "skip_question", { questionId });

/** The question a case is about, by the item it hangs on. */
const about = (profile: Support.ProfileAnswer, title: string): Support.AskedQuestion => {
  const found = profile.questions.find((question) => question.itemTitle === title);
  if (found === undefined) throw new Error(`no question about ${title}`);
  return found;
};

describe("answering with a row the reader offered (criterion 6)", () => {
  it("keeps a concern on the item, in the row's own words, from the answer", async () => {
    const person = await asked("answer-with-a-pick@example.com");
    const question = about(person.profile, "Kubernetes");
    const picked = question.options[1];

    const response = await answer(person.cookie, question.id, { optionId: picked?.id });
    expect(response.status).toBe(200);

    const after = await profileOf(person.cookie);
    const item = itemNamed(after, "Kubernetes");
    expect(item.concern?.text).toBe(
      "Kubernetes: deploying and running services, never cluster administration",
    );
    expect(item.concern?.source).toBe("answer");
    expect(about(after, "Kubernetes").state).toBe("answered");
  });

  it("keeps the person's own words verbatim, as their own words, with no pick (ID261)", async () => {
    const person = await asked("answer-with-words@example.com");
    const question = about(person.profile, "Terraform");

    expect(
      (
        await answer(person.cookie, question.id, {
          words: "I wrote the modules but somebody else applied them",
        })
      ).status,
    ).toBe(200);

    const item = itemNamed(await profileOf(person.cookie), "Terraform");
    expect(item.concern?.text).toContain("I wrote the modules but somebody else applied them");
    expect(item.concern?.text.startsWith("Terraform: ")).toBe(true);
    expect(item.concern?.source).toBe("own words");
  });

  /** `US6`: the person's own words are accepted beside a choice, and both are carried. */
  it("carries a pick and the words beside it in one concern", async () => {
    const person = await asked("answer-with-both@example.com");
    const question = about(person.profile, "Kubernetes");

    await answer(person.cookie, question.id, {
      optionId: question.options[0]?.id,
      words: "three clusters, one of them on bare metal",
    });

    const item = itemNamed(await profileOf(person.cookie), "Kubernetes");
    expect(item.concerns.length).toBe(1);
    expect(item.concern?.text).toContain(
      "Kubernetes: cluster administration, and the services on it",
    );
    expect(item.concern?.text).toContain("three clusters, one of them on bare metal");
  });

  it("refuses an answer that says nothing at all (ID261)", async () => {
    const person = await asked("answer-with-nothing@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await answer(person.cookie, question.id, {})).status).toBe(400);
    expect(itemNamed(await profileOf(person.cookie), "Kubernetes").concern).toBeNull();
  });
});

describe("answering again (criterion 7, ID121)", () => {
  it("adds a concern and supersedes the old one, and both are still readable", async () => {
    const person = await asked("answer-twice@example.com");
    const question = about(person.profile, "Kubernetes");

    await answer(person.cookie, question.id, { optionId: question.options[0]?.id });
    const first = itemNamed(await profileOf(person.cookie), "Kubernetes").concern;
    await answer(person.cookie, question.id, { optionId: question.options[2]?.id });

    const item = itemNamed(await profileOf(person.cookie), "Kubernetes");
    expect(item.concerns.length).toBe(2);
    expect(item.concern?.text).toBe("Kubernetes: shipping to a cluster run by others");
    expect(item.concerns.map((concern) => concern.text)).toContain(
      "Kubernetes: cluster administration, and the services on it",
    );
    // Nothing was overwritten: the first row is the same row, superseded.
    expect(item.concerns.map((concern) => concern.id)).toContain(first?.id);
  });
});

describe("skipping (criterion 8, US7)", () => {
  it("keeps the question rather than deleting it, and keeps no concern for it", async () => {
    const person = await asked("skip-one@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await skip(person.cookie, question.id)).status).toBe(200);

    const after = await profileOf(person.cookie);
    expect(about(after, "Kubernetes").state).toBe("skipped");
    expect(itemNamed(after, "Kubernetes").concern).toBeNull();
    expect(after.questions.length).toBe(person.profile.questions.length);
  });

  it("counts two answered and one for the builder", async () => {
    const person = await asked("skip-and-count@example.com");
    const [first, second, third] = person.profile.questions;

    await answer(person.cookie, first?.id ?? "", { optionId: first?.options[0]?.id });
    await answer(person.cookie, second?.id ?? "", { optionId: second?.options[0]?.id });
    await skip(person.cookie, third?.id ?? "");

    const after = await profileOf(person.cookie);
    const counted = (state: string) =>
      after.questions.filter((question) => question.state === state).length;
    expect(counted("answered")).toBe(2);
    expect(counted("skipped")).toBe(1);
  });
});

/**
 * The person's tool use, in the conversation (agent-consolidation `S7.1`, `H4`, `ID209`,
 * D9): an answer or a skip commits the question's state and a `person` entry with its part
 * in one transaction. The conversation is read back through its own route, never a table.
 */
describe("an answer or a skip, written into the conversation (S7.1, H4, D9)", () => {
  type Stored = {
    entries: { position: number; author: string; parts: Record<string, unknown>[] }[];
  };

  const conversationOf = async (cookie: string): Promise<Stored> =>
    (await (
      await app.request("/api/conversations/profile", { headers: { cookie } })
    ).json()) as Stored;

  /** Every option the question offered, as the part carries it: no concern. */
  const offered = (question: Support.AskedQuestion) =>
    question.options.map(({ id, label, hint }) => ({ id, label, hint }));

  /** The entries written after the ones a case read before it acted. */
  const since = (before: Stored, after: Stored) =>
    after.entries.slice(before.entries.length).map((entry) => [entry.author, entry.parts]);

  it("commits the answered state and one person entry holding the question, every option and the pick", async () => {
    const person = await asked("answer-into-the-conversation@example.com");
    const before = await conversationOf(person.cookie);
    const question = about(person.profile, "Kubernetes");
    const picked = question.options[1];

    const response = await answer(person.cookie, question.id, { optionId: picked?.id });
    expect(response.status).toBe(200);

    const part = {
      kind: "question_answered",
      lead: question.lead,
      where: question.where,
      options: offered(question),
      picked: picked?.id,
      words: null,
    };
    // The entry the route answers is the one the conversation holds.
    expect(
      ((await response.json()) as Stored).entries.map((entry) => [entry.author, entry.parts]),
    ).toEqual([["person", [part]]]);
    expect(about(await profileOf(person.cookie), "Kubernetes").state).toBe("answered");
    expect(since(before, await conversationOf(person.cookie))).toEqual([["person", [part]]]);
  });

  it("carries the person's words beside the pick, in the same part", async () => {
    const person = await asked("answer-with-words-into-the-conversation@example.com");
    const before = await conversationOf(person.cookie);
    const question = about(person.profile, "Kubernetes");

    await answer(person.cookie, question.id, {
      optionId: question.options[0]?.id,
      words: "three clusters, one of them on bare metal",
    });

    expect(since(before, await conversationOf(person.cookie))).toEqual([
      [
        "person",
        [
          expect.objectContaining({
            kind: "question_answered",
            picked: question.options[0]?.id,
            words: "three clusters, one of them on bare metal",
          }),
        ],
      ],
    ]);
  });

  it("commits the skipped state and one person entry holding the question and every option", async () => {
    const person = await asked("skip-into-the-conversation@example.com");
    const before = await conversationOf(person.cookie);
    const question = about(person.profile, "Kubernetes");

    expect((await skip(person.cookie, question.id)).status).toBe(200);

    expect(about(await profileOf(person.cookie), "Kubernetes").state).toBe("skipped");
    expect(since(before, await conversationOf(person.cookie))).toEqual([
      [
        "person",
        [
          {
            kind: "question_skipped",
            lead: question.lead,
            where: question.where,
            options: offered(question),
          },
        ],
      ],
    ]);
  });

  it("opens the conversation with its opening when there is none yet, then the person's entry (5.2, W1)", async () => {
    const person = await asked("answer-before-any-conversation@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await skip(person.cookie, question.id)).status).toBe(200);

    const stored = await conversationOf(person.cookie);
    expect(stored.entries.map((entry) => [entry.position, entry.author])).toEqual([
      [1, "assistant"],
      [2, "person"],
    ]);
    expect(stored.entries[0]?.parts[0]).toMatchObject({ kind: "text", scripted: true });
    expect(stored.entries[1]?.parts[0]).toMatchObject({ kind: "question_skipped" });
  });

  it("keeps the question's state, keeps no concern and no entry, and answers 500 when the entry cannot be written", async () => {
    const person = await asked("answer-whose-entry-fails@example.com");
    const before = await conversationOf(person.cookie);
    const question = about(person.profile, "Kubernetes");
    const { failingOn } = await import("../support/failing-entry");
    const failure = await failingOn(testDb, "INJECTED-FAILURE-S71");

    let status: number;
    try {
      status = (
        await answer(person.cookie, question.id, {
          optionId: question.options[0]?.id,
          words: "INJECTED-FAILURE-S71",
        })
      ).status;
    } finally {
      await failure.dispose();
    }

    expect(status).toBe(500);
    const after = await profileOf(person.cookie);
    expect(about(after, "Kubernetes").state).toBe("waiting");
    expect(itemNamed(after, "Kubernetes").concern).toBeNull();
    expect(await conversationOf(person.cookie)).toEqual(before);
  });
});

describe("what belongs to somebody else, and what is gone (US11, Failure modes, 4.4)", () => {
  it("answers 404 for another person's question, and touches no row of theirs", async () => {
    const owner = await asked("answer-owner@example.com");
    const stranger = await asked("answer-stranger@example.com");
    const question = about(owner.profile, "Kubernetes");

    const response = await answer(stranger.cookie, question.id, {
      optionId: question.options[0]?.id,
    });

    expect(response.status).toBe(404);
    const theirs = await profileOf(owner.cookie);
    expect(itemNamed(theirs, "Kubernetes").concern).toBeNull();
    expect(about(theirs, "Kubernetes").state).toBe("waiting");
  });

  it("answers 404 once the item has been removed, and the question is gone with it", async () => {
    const person = await asked("answer-after-removal@example.com");
    const question = about(person.profile, "Kubernetes");
    const { profileItem } = await import("@app/db");
    const { eq } = await import("drizzle-orm");
    await testDb.delete(profileItem).where(eq(profileItem.id, question.itemId));

    expect(
      (await answer(person.cookie, question.id, { optionId: question.options[0]?.id })).status,
    ).toBe(404);
    expect((await profileOf(person.cookie)).questions.some((each) => each.id === question.id)).toBe(
      false,
    );
  });

  it("answers 404 for an action the assistant does not name, and for an assistant no definition names", async () => {
    const person = await asked("answer-unknown-action@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await act(person.cookie, "delete_question", { questionId: question.id })).status).toBe(
      404,
    );
    expect(
      (await act(person.cookie, "skip_question", { questionId: question.id }, "unknown")).status,
    ).toBe(404);
    expect(about(await profileOf(person.cookie), "Kubernetes").state).toBe("waiting");
  });

  it("answers 409 before any reading, and opens nothing", async () => {
    const person = await signedIn("answer-before-a-reading@example.com");

    const response = await skip(person.cookie, "a-question-of-nobody");

    expect(response.status).toBe(409);
    expect(
      (await app.request("/api/conversations/profile", { headers: { cookie: person.cookie } }))
        .status,
    ).toBe(409);
  });
});
