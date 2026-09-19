import { document, question, questionOption } from "@app/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectKey, Storage, StoredObject } from "../../src/lib/storage";
import { subjectAt } from "../support/providers";
import { localStorageIn, objectsHeld } from "../support/storage";

/**
 * Seam D: `routes/intake`, `POST /read`, read as a stream (criteria 10, 11, 12).
 *
 * Behind the seam: the same PGlite database and the same directory storage as seam B,
 * and `lib/ai` answering from the mock's recorded intake cases in this very process. No
 * provider, no network, no port: the client's `fetch` is the application's own handler
 * (`tests/support/ai.ts`), which is also what records every request so the case header
 * can be asserted and the claim that nothing leaves the process can be held.
 *
 * **The run is one call now** (`ID157`, `ID158`). Every document of a run is turned into
 * text, the texts are joined into one composed document, and one reading answers with
 * the whole profile and the questions it leaves open. So what this file asserts about
 * the shape of the run is one case header naming every document, in the run's order, and
 * not a sequence of calls per document; nothing here classifies, extracts or merges,
 * because the product does none of the three.
 *
 * Not past it: `lib/ai`'s own behaviour and the mock's envelopes, which are SL1's seams,
 * and `lib/text`'s reading of a PDF or a Word file, which has its own suite.
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

// The AI, answered in this process by the application's own mock (`tests/support/ai.ts`).
// The product's instance is built from `env.ts` and would resolve a host; this one never
// opens a socket, and every request it makes is recorded, which is how the case header is
// asserted and how "no provider is reached from anywhere" is held.
vi.mock("../../src/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/ai")>();
  const { askForThroughTheApp } = await import("../support/ai");
  return { ...real, askFor: askForThroughTheApp() };
});

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet, uploadOfFixture } = await import("../support/documents");
const { forgetRequests, requestsSent, withCases } = await import("../support/ai");
const { withQuestions } = await import("../support/questions");

let storage: ReturnType<typeof localStorageIn>;

beforeEach(() => {
  storage = localStorageIn();
  objects.storage = storage;
  forgetRequests();
});

afterEach(() => {
  storage.dispose();
  vi.unstubAllGlobals();
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
  // The provider's doors are only needed for the round trip; the reading reaches nothing.
  vi.unstubAllGlobals();
  return { id: user.id, cookie: cookiesSetBy(response) };
};

/** One frame's leaf, as the envelope put it on the wire. */
type Leaf = { kind: string; id?: string; status?: string; reason?: string | null };

const leavesOf = (body: string): Leaf[] =>
  body
    .split("\n\n")
    .filter((block) => block.startsWith("id: "))
    .map((block) => {
      const line = block.split("\n").find((each) => each.startsWith("data: ")) ?? "data: {}";
      return (JSON.parse(line.slice("data: ".length)) as { leaf: Leaf }).leaf;
    });

const read = (cookie: string) =>
  app.request("/api/intake/read", { method: "POST", headers: { cookie } });

const rowsOf = (userId: string) =>
  testDb
    .select()
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(document.createdAt, document.id);

const statusesOf = async (userId: string) =>
  (await rowsOf(userId)).map((row) => [row.filename, row.status]);

/**
 * What the person holds in `question` and `question_option`, counted in the tables
 * themselves (`ID333`).
 *
 * The one claim this file makes about them is that a reading writes neither, and a claim
 * about rows that are not there cannot be read back through a route: `GET /profile`
 * answers with the questions it would show, which is already none when five were written
 * and none of them asked. So the tables are counted, and only for this.
 */
const questionRowsOf = async (userId: string): Promise<{ questions: number; options: number }> => {
  const questions = await testDb.select().from(question).where(eq(question.userId, userId));
  const options =
    questions.length === 0
      ? []
      : await testDb
          .select()
          .from(questionOption)
          .where(
            inArray(
              questionOption.questionId,
              questions.map((row) => row.id),
            ),
          );
  return { questions: questions.length, options: options.length };
};

/** The three real documents a run is driven over, which the mock has the run's case for. */
const three = [theSet.cvFrench.filename, theSet.cvEnglish.filename, theSet.diploma.filename];

/**
 * A name the suite has no document for, given a media type that holds no characters at
 * all. It stands for the one thing that still fails alone: a file nothing can turn into
 * text, refused before the call rather than by it (`ID157`, `ID159`).
 */
const aPhotograph = "a-photograph-of-a-paper-cv.jpg";

/** A document's name as the reading composes it and a source cites it: no extension. */
const slug = (filename: string) => filename.slice(0, filename.lastIndexOf("."));

/**
 * One more document handed over the way a browser hands one over, and the case name the
 * run that reads it will ask under.
 *
 * It goes through the upload route rather than straight into the rows, because a second
 * reading needs a row whose object is really in storage — and since `ID309` the documents
 * a first reading took have none left.
 *
 * The case is `intake.read-more` and not `intake.read` (`ID315`): every caller of this is
 * a person who already has a profile, so the run it names is the second reading.
 */
const oneMore = async (cookie: string, filename: string) => {
  const added = await app.request("/api/intake/documents", {
    method: "POST",
    headers: { cookie },
    body: uploadOfFixture(filename),
  });
  expect(added.status).toBe(201);
  const { id } = (await added.json()) as { id: string };
  return { id, case: `intake.read-more:${slug(filename)}` };
};

/** What the second document said about a fact the second reading answers with. */
const saidByTheFrenchCv = (said: string) => [{ document: slug(theSet.cvFrench.filename), said }];

/**
 * A second reading's answer, written here rather than shipped (`ID308`).
 *
 * The one recording the project ships for a second reading stands for the ownership CV
 * and nothing else (`ID317`); every claim below is about a document the project ships no
 * second reading of, so its answer is the test's own.
 */
const aSecondReading = (answer: {
  items?: unknown[];
  extends?: unknown[];
  candidates?: unknown[];
}) =>
  JSON.stringify({
    items: answer.items ?? [],
    extends: answer.extends ?? [],
    candidates: answer.candidates ?? [],
  });

/** The answer of a reading that found nothing the profile does not already hold. */
const nothingNew = aSecondReading({});

describe("the reading run (criterion 10, D8)", () => {
  it("marks each document reading, in order, then read, and says it is done", async () => {
    const person = await signedIn("three-documents-read@example.com");
    const rows = await documentsFor(person.id, three, storage);

    const leaves = leavesOf(await (await read(person.cookie)).text());

    // Each document is marked as the run reaches it, in the order the person handed
    // them over; the reading that follows is one call, and its success marks all three.
    expect(leaves.filter((leaf) => leaf.status === "reading").map((leaf) => leaf.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(leaves.filter((leaf) => leaf.status === "read").length).toBe(3);
    expect(leaves.at(-1)?.kind).toBe("run");
  });

  /**
   * One call for the whole run, its case naming every document in order (`ID157`, the
   * person 2026-09-12). This test used to assert a classification and an extraction per
   * document, then a merge and a pass for the questions — 2n+2 calls. The claim it kept
   * is the same one: what the run asks for is exactly what the run needs, and the header
   * says which documents it is about. What changed is that there is one of them.
   */
  it("makes one call for the whole run, its case naming every document, sorted", async () => {
    const person = await signedIn("one-call-each@example.com");
    await documentsFor(person.id, three, storage);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR+BS-HEIGVD-IL-Diplome",
    ]);
  });

  /**
   * The same documents are the same reading, whichever order they were handed over in
   * (`ID321`).
   *
   * `three` is handed over French first and this case hands the very same three over
   * backwards; both name one reading. The order decides which part of the composed
   * document comes first and nothing else, because a fact cites its part by name and not
   * by position — so a run of *n* documents had *n!* names for one reading, and the
   * project shipped two byte-identical recordings to cover two of them.
   */
  it("names the same reading whichever order the documents were handed over in", async () => {
    const person = await signedIn("any-order-one-case@example.com");
    await documentsFor(person.id, [...three].reverse(), storage);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR+BS-HEIGVD-IL-Diplome",
    ]);
  });

  /**
   * What the row says a document is, and what it does not say (`ID158`).
   *
   * This test used to assert that the reading wrote back a kind and a language it had
   * detected. Nothing detects either any more: the run does not care what kind of
   * document it was handed — *"it can be a novel by Dostojevski if he wants it"* — so
   * the kind on a row stays `kindOf`'s guess from the filename, made at the upload, and
   * the language column is never written at all. The claim is the same claim, about the
   * columns a person's row carries after a run; the answer is now "what the upload
   * guessed, and no language".
   */
  it("leaves the row the kind the upload guessed, and detects no language of its own", async () => {
    const person = await signedIn("kind-and-language@example.com");
    for (const filename of [theSet.cvFrench.filename, theSet.cvEnglish.filename]) {
      await app.request("/api/intake/documents", {
        method: "POST",
        headers: { cookie: person.cookie },
        body: uploadOfFixture(filename),
      });
    }

    await (await read(person.cookie)).text();

    const rows = await rowsOf(person.id);
    expect(
      Object.fromEntries(
        rows.map((row) => [row.filename, [row.detectedKind, row.detectedLanguage, row.status]]),
      ),
    ).toEqual({
      "2026-08-30_cv_FR.pdf": ["cv", null, "read"],
      "2026-08-30_cv_EN.pdf": ["cv", null, "read"],
    });
  });

  /**
   * The document's row is written before its frame leaves, not at the end of the run
   * (`D8`, and the slice's "watch out"). By the time the first `read` frame is in a
   * reader's hands, the database already says so — which is the only thing that makes
   * a reload mid-run agree with the screen.
   */
  it("persists a document's row before it sends that document's frame", async () => {
    const person = await signedIn("persisted-as-it-lands@example.com");
    const [first] = await documentsFor(person.id, three, storage);
    const response = await read(person.cookie);
    const reader = (response.body ?? new ReadableStream()).getReader();
    const decoder = new TextDecoder();

    let seen = "";
    while (!leavesOf(seen).some((leaf) => leaf.id === first?.id && leaf.status === "read")) {
      const next = await reader.read();
      if (next.done) break;
      seen += decoder.decode(next.value, { stream: true });
    }

    const [row] = await testDb
      .select()
      .from(document)
      .where(eq(document.id, first?.id ?? ""));
    expect(row?.status).toBe("read");
    expect(row?.readAt).not.toBeNull();
    await reader.cancel();
  });

  /**
   * A document failing alone is now one thing and one thing only: a file that cannot
   * become text (`ID157`). It is refused before the call, so the run goes on without it
   * and the others are read. Everything past that point is one call over all of them,
   * and that failure is the whole run's — the case below this one.
   */
  it("marks the one document it cannot turn into text and reads the others", async () => {
    const person = await signedIn("one-fails@example.com");
    await documentsFor(
      person.id,
      [theSet.cvFrench.filename, aPhotograph, theSet.cvEnglish.filename],
      storage,
    );

    await (await read(person.cookie)).text();

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_FR.pdf", "read"],
      [aPhotograph, "failed"],
      ["2026-08-30_cv_EN.pdf", "read"],
    ]);
    // And the reading was asked about the two that became text, and only those.
    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR",
    ]);
  });

  it("says of the failed one what went wrong, naming it", async () => {
    const person = await signedIn("failure-named@example.com");
    await documentsFor(person.id, [aPhotograph], storage);

    await (await read(person.cookie)).text();

    const [row] = await testDb.select().from(document).where(eq(document.userId, person.id));
    expect(row?.failureReason).toMatch(/a-photograph-of-a-paper-cv\.jpg/);
  });

  /**
   * The other half of the same decision, and the one this file did not have to make
   * before: one call over every document is one failure over every document (`ID157`).
   *
   * A run whose reading fails leaves nothing half written — no profile, no questions —
   * and leaves every document of that call unread, so the next run takes them again.
   * That last part is what makes the failure safe to tell a person about in one
   * sentence: nothing was lost.
   */
  it("fails every document of the run when the one call fails, and leaves them for the next run", async () => {
    const person = await signedIn("the-call-fails@example.com");
    const two = [theSet.cvFrench.filename, theSet.cvEnglish.filename];
    await documentsFor(person.id, two, storage);

    // The run's case answered with the words a miss answers with (`ID166`): a test's answer
    // is tried before the project's own and cannot take one away (`ID295`), so the reading
    // that cannot be had is written in its place. It is not JSON, and the reading fails.
    const nothingUsable = withCases({
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR": { content: "No pre generated text" },
    });
    try {
      await (await read(person.cookie)).text();
    } finally {
      nothingUsable.dispose();
    }

    const failed = await rowsOf(person.id);
    expect(failed.map((row) => [row.filename, row.status])).toEqual([
      ["2026-08-30_cv_FR.pdf", "failed"],
      ["2026-08-30_cv_EN.pdf", "failed"],
    ]);
    expect(failed.map((row) => row.failureReason)).toEqual([
      "Your documents could not be read this time. Nothing was lost: try again.",
      "Your documents could not be read this time. Nothing was lost: try again.",
    ]);
    // Unread, not read-and-empty: nothing was written and nothing is skipped next time.
    expect(failed.every((row) => row.readAt === null)).toBe(true);

    // And the next run does take them again, with the answer the product ships.
    await (await read(person.cookie)).text();
    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_FR.pdf", "read"],
      ["2026-08-30_cv_EN.pdf", "read"],
    ]);
  });

  it("reaches no provider from anywhere: every request went to this application", async () => {
    const person = await signedIn("no-provider-reached@example.com");
    await documentsFor(person.id, three, storage);

    await (await read(person.cookie)).text();

    expect(requestsSent()).not.toHaveLength(0);
    // `tests/support/ai.ts` answers out of `app.fetch`, so a request recorded here is a
    // request that never left the process. A provider would have to be a second fetch,
    // and the mock holds no client to make one with.
    expect(requestsSent().every((request) => request.body !== undefined)).toBe(true);
  });

  it("turns a run away with no session at all", async () => {
    expect((await app.request("/api/intake/read", { method: "POST" })).status).toBe(401);
  });
});

/**
 * What a reading pushes into the profile conversation (SL8, D34, `ID311`): once the
 * profile is written, the person's profile conversation, when there is one, gets one
 * `system` entry holding a summary of what that reading changed. Read back through
 * `GET /api/conversations/profile`, as the column reads it.
 *
 * The notice was one fixed sentence when a reading rewrote the profile whole; it says now
 * which documents were read and what they added, because a reading that adds can add
 * nothing, and a person told "your profile was updated" when it was not has been misled.
 * It is built from the rows the write inserted and never from a second call.
 */
describe("the profile conversation, told of a reading (D34, ID311)", () => {
  type Conversation = { entries: { author: string; parts: Record<string, unknown>[] }[] };

  const conversationOf = async (cookie: string): Promise<Conversation> => {
    const answer = await app.request("/api/conversations/profile", { headers: { cookie } });
    expect(answer.status).toBe(200);
    return (await answer.json()) as Conversation;
  };

  const systemEntriesOf = (conversation: Conversation) =>
    conversation.entries.filter((entry) => entry.author === "system");

  /** What every notice in a conversation says, in the order it was written. */
  const noticesOf = (conversation: Conversation): string[] =>
    systemEntriesOf(conversation).flatMap((entry) =>
      entry.parts.filter((part) => part["kind"] === "notice").map((part) => String(part["text"])),
    );

  /**
   * The person's English CV read, their profile conversation opened on it, and a second
   * document handed over and waiting.
   *
   * A reading disposes of what it read (`ID309`), so a second reading is a second
   * document and never the same one put back: there is no file behind a row the reading
   * has consumed. The second run is the one with a conversation to be told about.
   */
  const readThenOpened = async (email: string) => {
    const person = await signedIn(email);
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    await (await read(person.cookie)).text();
    const opened = await conversationOf(person.cookie);
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    return { person, opened, second };
  };

  /** The one new item a second reading is given to find, and the title it lands under. */
  const aCertificate = {
    kind: "education",
    title: "A certificate of employment",
    education: { institution: "HEIG-VD" },
    sources: saidByTheFrenchCv("Certificat de travail, HEIG-VD."),
  };

  it("appends one system entry naming the documents and what they added", async () => {
    const { person, opened, second } = await readThenOpened("notified-after-reading@example.com");
    const cases = withCases({
      [second.case]: { content: aSecondReading({ items: [aCertificate] }) },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const after = await conversationOf(person.cookie);
    expect(after.entries.slice(0, opened.entries.length)).toEqual(opened.entries);
    expect(after.entries.slice(opened.entries.length)).toEqual([
      expect.objectContaining({
        author: "system",
        parts: [
          {
            kind: "notice",
            text: "Your profile was updated from your documents: 2026-08-30_cv_FR. It added A certificate of employment. Read it again before relying on it.",
          },
        ],
      }),
    ]);
  });

  /**
   * The other half of `ID311`: what was added **to**. A line on a post the profile already
   * holds is the commonest thing a second document carries, and a notice that named only
   * brand new items would say nothing at all about it.
   */
  it("names the items it added to as well as the items it added", async () => {
    const { person, second } = await readThenOpened("notice-names-what-it-extended@example.com");
    const post = (await profileOf(person.cookie)).experience[0];
    const cases = withCases({
      [second.case]: {
        content: aSecondReading({
          extends: [
            {
              itemId: post?.id,
              lines: [
                {
                  text: "Led the migration to Kubernetes.",
                  sources: saidByTheFrenchCv("Led the migration to Kubernetes."),
                },
              ],
            },
          ],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(noticesOf(await conversationOf(person.cookie))).toEqual([
      `Your profile was updated from your documents: 2026-08-30_cv_FR. It added to ${post?.title}. Read it again before relying on it.`,
    ]);
  });

  it("counts the titles past ten rather than reciting them", async () => {
    const { person, second } = await readThenOpened("notice-caps-the-titles@example.com");
    const twelve = Array.from({ length: 12 }, (_, at) => ({
      ...aCertificate,
      title: `A certificate ${at + 1}`,
    }));
    const cases = withCases({ [second.case]: { content: aSecondReading({ items: twelve }) } });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(noticesOf(await conversationOf(person.cookie))).toEqual([
      "Your profile was updated from your documents: 2026-08-30_cv_FR. It added A certificate 1, A certificate 2, A certificate 3, A certificate 4, A certificate 5, A certificate 6, A certificate 7, A certificate 8, A certificate 9, A certificate 10; and 2 more. Read it again before relying on it.",
    ]);
  });

  /**
   * A reading that found nothing is a reading, and the notice says so rather than
   * announcing an update that did not happen (`ID311`). The instruction to read the
   * profile again stands either way: the agent cannot know which of the two it was.
   */
  it("says nothing new was found when the documents added nothing", async () => {
    const { person, second } = await readThenOpened("notice-with-nothing-new@example.com");
    const cases = withCases({ [second.case]: { content: nothingNew } });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(noticesOf(await conversationOf(person.cookie))).toEqual([
      "Your documents were read: 2026-08-30_cv_FR. Nothing new was found in them. Read it again before relying on it.",
    ]);
  });

  it("writes nothing to a conversation that does not exist yet, and opens none", async () => {
    const person = await signedIn("notified-with-no-conversation@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();

    // The first GET creates the conversation: its opening alone, no notice before it.
    expect(systemEntriesOf(await conversationOf(person.cookie))).toEqual([]);
  });

  it("notifies nothing when the reading fails", async () => {
    const { person, opened, second } = await readThenOpened("not-notified-on-failure@example.com");
    const nothingUsable = withCases({ [second.case]: { content: "No pre generated text" } });
    try {
      await (await read(person.cookie)).text();
    } finally {
      nothingUsable.dispose();
    }

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_EN.pdf", "read"],
      ["2026-08-30_cv_FR.pdf", "failed"],
    ]);
    expect(await conversationOf(person.cookie)).toEqual(opened);
  });

  it("still ends the reading as done when the notice cannot be written", async () => {
    const { person, opened, second } = await readThenOpened("notice-fails@example.com");
    const cases = withCases({ [second.case]: { content: nothingNew } });
    const { Hono } = await import("hono");
    const { intakeOf } = await import("../../src/routes/intake");
    const { profileAssistant } = await import("../../src/assistants/profile");
    const { agentOn, conversationStore } = await import("../support/agent");
    const failing = agentOn({
      store: {
        ...conversationStore,
        append: () => Promise.reject(new Error("the store refused the notice")),
      },
    });
    const routes = new Hono().route("/api/intake", intakeOf(failing, profileAssistant));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await routes.request("/api/intake/read", {
        method: "POST",
        headers: { cookie: person.cookie },
      });
      const leaves = leavesOf(await response.text());

      expect(leaves.at(-1)).toEqual(expect.objectContaining({ kind: "run", status: "done" }));
      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_EN.pdf", "read"],
        ["2026-08-30_cv_FR.pdf", "read"],
      ]);
      expect(await conversationOf(person.cookie)).toEqual(opened);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      cases.dispose();
      logged.mockRestore();
    }
  });

  it("notifies nothing on a run with nothing new to read", async () => {
    const person = await signedIn("not-notified-on-nothing-new@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    await (await read(person.cookie)).text();
    const opened = await conversationOf(person.cookie);

    await (await read(person.cookie)).text();

    expect(await conversationOf(person.cookie)).toEqual(opened);
  });
});

describe("resume is a read of the rows (criterion 11, US3)", () => {
  it("leaves the rows where the run got to when the reader walks away mid-stream", async () => {
    const person = await signedIn("walks-away@example.com");
    const [first] = await documentsFor(person.id, three, storage);
    const response = await read(person.cookie);
    const reader = (response.body ?? new ReadableStream()).getReader();
    const decoder = new TextDecoder();

    let seen = "";
    while (!leavesOf(seen).some((leaf) => leaf.id === first?.id && leaf.status === "read")) {
      const next = await reader.read();
      if (next.done) break;
      seen += decoder.decode(next.value, { stream: true });
    }
    await reader.cancel();

    // The list route is the resume, and it is the only one: no run id in the browser,
    // no replay of frames from anybody's memory.
    const listed = (await (
      await app.request("/api/intake/documents", { headers: { cookie: person.cookie } })
    ).json()) as { filename: string; status: string }[];
    expect(listed.find((row) => row.filename === "2026-08-30_cv_FR.pdf")?.status).toBe("read");
    expect(listed.map((row) => row.status)).not.toContain("failed");
  });

  it("says nothing new about a document it has already read, so a second run is not a second reading", async () => {
    const person = await signedIn("second-run@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    await (await read(person.cookie)).text();
    forgetRequests();

    await (await read(person.cookie)).text();

    expect(requestsSent()).toEqual([]);
  });
});

/**
 * Seam B's other half: what the reading writes (criteria 3, 4, 5).
 *
 * Behind it, the same PGlite and the same in-process mock. What is asserted is read
 * back through `GET /api/intake/profile`, because the route that writes a profile is
 * the route that reads it; nothing here selects from `profile_item`.
 *
 * These four cases were written against a merge over separate per-document extractions,
 * and every one of them still holds: the claims are about the profile a run leaves
 * behind — one item for a fact two documents state, every document's own wording kept
 * against it, no third wording invented, and a group's entries flat. What changed is who
 * makes the profile that way. It used to be the shape of the pipeline; it is now the
 * answer, which cites the part every fact came from and is refused if it cites a part
 * this run did not read.
 *
 * Not past it: the fixtures' contents. That a case says what a real reader would say is
 * the business of whoever records it, and these were written from the person's own
 * documents (`D20`).
 */
type Item = {
  id: string;
  kind: string;
  title: string;
  entry: { label: string; qualifier: string | null } | null;
  lines: { id: string; text: string }[];
  children: Item[];
  concerns: { text: string }[];
};

type Profile = {
  readOn: string | null;
  summary: Item | null;
  identity: Item | null;
  experience: Item[];
  projects: Item[];
  groups: Item[];
  education: Item[];
  questions: { id: string; itemId: string; state: string }[];
};

/**
 * Every item of a profile, of every kind and at every depth, so a claim about all of them
 * names all of them: a group's entries are items too, and a concern can be kept on one.
 */
const everyItemOf = (profile: Profile): Item[] => {
  const withItsOwn = (item: Item): Item[] => [item, ...item.children.flatMap(withItsOwn)];
  return [
    profile.summary,
    profile.identity,
    ...profile.experience,
    ...profile.projects,
    ...profile.groups,
    ...profile.education,
  ]
    .filter((item): item is Item => item !== null)
    .flatMap(withItsOwn);
};

const profileOf = async (cookie: string): Promise<Profile> => {
  const answer = await app.request("/api/intake/profile", { headers: { cookie } });
  return (await answer.json()) as Profile;
};

describe("what one reading of the composed documents writes (criteria 3, 4, 5)", () => {
  /**
   * The claim is not how many posts the CVs state — they state eight, and the profile
   * carries eight. It is that a post **both** documents state is **one** item rather than
   * two, one per language.
   *
   * It used to be made by finding the item two documents were kept against; no fact cites
   * a document any more (`ID334`), so it is made against the post itself, named as the
   * profile names it.
   */
  it("gives a post both CVs state one item and not two", async () => {
    const person = await signedIn("one-month-two-languages@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);

    // Both CVs state this post, one in French and one in English, and neither wording of
    // it is a second row: the French title is nowhere in the profile.
    expect(
      profile.experience.filter(
        (post) => post.title === "R&D Collaborator in Software Engineering",
      ),
    ).toHaveLength(1);
    expect(profile.experience.map((post) => post.title)).not.toContain(
      "Collaborateur R&D en genie logiciel",
    );
  });

  it("gives one item and one title for a post the two documents state differently", async () => {
    const person = await signedIn("two-documents-disagree@example.com");
    await documentsFor(person.id, [theSet.cvWord2022.filename, theSet.cv2025.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const post = profile.experience[0];

    expect(profile.experience).toHaveLength(1);
    // The reading picked no winner and invented no sentence of its own: the title it wrote
    // is one of the two the documents state, and not a third wording.
    expect(["Assistant HES", "R&D Collaborator in Software Engineering"]).toContain(post?.title);
  });

  it("writes a group's entries flat, and no year on any of them", async () => {
    const person = await signedIn("flat-groups-no-years@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const entries = profile.groups.flatMap((group) => group.children);

    // Which groups a CV states is the CV's business; that each one is a group of flat
    // entries is this test's.
    expect(profile.groups.map((group) => group.title)).toContain("Languages");
    expect(entries.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["TypeScript", "Python", "Docker", "Kubernetes"]),
    );
    // Flat by construction: an entry has nothing under it, whatever the reading answers.
    expect(entries.flatMap((entry) => entry.children)).toEqual([]);
    // And no duration anywhere: `item_entry` has no column for one, so a year or a span
    // of years on a chip is a thing the database cannot hold rather than a thing the
    // screen omits (D16). A digit is not the test — `OAuth2` and `Next.js` are names a
    // CV states — a year is.
    for (const entry of entries) {
      const chip = `${entry.title} ${entry.entry?.label} ${entry.entry?.qualifier ?? ""}`;
      expect(chip).not.toMatch(/\b(19|20)\d{2}\b/);
      expect(chip).not.toMatch(/\b\d+\s*(year|years|yr|yrs|month|months)\b/i);
    }
  });

  /**
   * A run writes no `provenance` row (`ID334`, `S4.1`).
   *
   * The table is gone, so the claim is made where a person would have seen it: the answer
   * the reading's own route wrote, read back through `GET /profile`, carries no quote and
   * no count on any item or any line, at any depth. The answer the reader gave still
   * cites its documents — the writer reads those citations and refuses an answer whose
   * source it cannot resolve — and keeps none of them.
   */
  it("keeps nothing of what a document said: no source and no count on any row", async () => {
    const person = await signedIn("a-run-writes-no-provenance@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);

    // A real profile was written, so the claim cannot pass on an empty answer.
    expect(everyItemOf(profile).length).toBeGreaterThan(20);
    expect(everyItemOf(profile).some((item) => item.lines.length > 0)).toBe(true);
    expect(Object.keys(profile)).not.toContain("documents");
    for (const item of everyItemOf(profile)) {
      expect(Object.keys(item)).not.toContain("sources");
      expect(Object.keys(item)).not.toContain("documents");
      for (const line of item.lines) {
        expect(Object.keys(line)).not.toContain("sources");
        expect(Object.keys(line)).not.toContain("documents");
      }
    }
  });
});

/**
 * An answer that cannot be used (spec, *Failure modes*).
 *
 * Both cases below were about half a run surviving the other half: a document whose
 * extraction was malformed failed while the rest were read, and a merge that answered
 * something unusable left the documents read with their facts intact. Neither half
 * exists any more — there is one call — so the claim each of them was really making is
 * restated against the one answer: **nothing is written unless the whole answer is
 * usable**, and an unusable one costs the person nothing but a second press.
 *
 * They are two cases because there are two ways to be unusable, and they are refused in
 * two different places: a shape the boundary rejects, and a citation the writer cannot
 * resolve to a document of this run.
 */
const twoCvs = [theSet.cvFrench.filename, theSet.cvEnglish.filename];
const theRunsCase = "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR";

describe("an answer that cannot be used (spec, Failure modes)", () => {
  it("writes no part of a profile when the answer carries an item nothing stands behind", async () => {
    const person = await signedIn("malformed-reading@example.com");
    await documentsFor(person.id, twoCvs, storage);
    const cases = withCases({
      // An item citing nothing: the one thing this product promises not to produce, and
      // so the one thing the boundary refuses before a row is written.
      [theRunsCase]: {
        stands_for: "a reading that answered with an item no document stands behind",
        content: '{"items":[{"kind":"identity","title":"Somebody","sources":[]}],"candidates":[]}',
      },
    });

    try {
      await (await read(person.cookie)).text();

      // One call, so one failure: both documents, and both still unread.
      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_FR.pdf", "failed"],
        ["2026-08-30_cv_EN.pdf", "failed"],
      ]);
      const profile = await profileOf(person.cookie);
      expect(everyItemOf(profile)).toEqual([]);
    } finally {
      cases.dispose();
    }
  });

  it("writes no part of a profile when the answer cites a document this run did not read", async () => {
    const person = await signedIn("cites-what-was-not-read@example.com");
    await documentsFor(person.id, twoCvs, storage);
    const cases = withCases({
      // Attribution is a claim the answer makes now, not something the shape of the
      // pipeline guaranteed (`ID157`), so it is checked: a fact whose source is a part
      // this run never composed is refused, and the whole profile with it.
      [theRunsCase]: {
        stands_for: "a reading that attributed a fact to a document nobody handed over",
        content:
          '{"items":[{"kind":"identity","title":"Stefan Teofanovic","sources":[{"document":"a-cv-from-another-life","said":"Stefan Teofanovic, Montreux, Suisse."}]}],"candidates":[]}',
      },
    });

    try {
      await (await read(person.cookie)).text();

      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_FR.pdf", "failed"],
        ["2026-08-30_cv_EN.pdf", "failed"],
      ]);
      const profile = await profileOf(person.cookie);
      expect(everyItemOf(profile)).toEqual([]);
    } finally {
      cases.dispose();
    }
  });

  /**
   * The third way to be unusable, and the one that outlived what it was written for
   * (moved here from `intake-questions` by `S3.1`).
   *
   * A reading writes no question any more, but the candidates an answer carries are still
   * read and still held to their shape, because every shipped recording answers with them
   * and the corpus is adapted where the reading's output is settled. So a candidate the
   * boundary refuses is still a reading the boundary refuses: **nothing at all is
   * written**, and that costs the person nothing but a second press.
   */
  it("writes no part of a profile when the candidates half of the answer is malformed", async () => {
    const person = await signedIn("malformed-candidates@example.com");
    await documentsFor(person.id, twoCvs, storage);
    const cases = withCases({
      [theRunsCase]: {
        stands_for: "a reading whose candidates are not candidates at all",
        content: JSON.stringify({
          items: [
            {
              kind: "identity",
              title: "Somebody",
              sources: [{ document: "2026-08-30_cv_EN", said: "Somebody" }],
            },
          ],
          // A candidate with no lead, no where and no options: refused at the boundary.
          candidates: [{ kind: "scope", item: "Somebody" }],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();

      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_FR.pdf", "failed"],
        ["2026-08-30_cv_EN.pdf", "failed"],
      ]);
      const profile = await profileOf(person.cookie);
      expect(everyItemOf(profile)).toEqual([]);
    } finally {
      cases.dispose();
    }
  });

  /**
   * The reading retries once and no more (spec, *Failure modes*), moved here from
   * `intake-questions` by `S3.1` with the suite it was written in: it is a claim about
   * the run's one call, which this file is about, and never about the questions.
   */
  it("retries the run's one call once before giving up", async () => {
    const person = await signedIn("read-retried-once@example.com");
    await documentsFor(person.id, twoCvs, storage);

    await (await read(person.cookie)).text();

    expect(
      requestsSent().filter((sent) => sent.headers["x-jobapp-case"] === theRunsCase),
    ).toHaveLength(1);

    // And when it fails, it is asked twice and no more.
    forgetRequests();
    const other = await signedIn("read-retried-twice@example.com");
    await documentsFor(other.id, twoCvs, storage);
    const nothingUsable = withCases({ [theRunsCase]: { content: "No pre generated text" } });
    try {
      await (await read(other.cookie)).text();
    } finally {
      nothingUsable.dispose();
    }

    expect(
      requestsSent().filter((sent) => sent.headers["x-jobapp-case"] === theRunsCase),
    ).toHaveLength(2);
  });
});

/**
 * A reading writes no question (`ID333`, this slice).
 *
 * The run used to end by writing the questions its answer proposed; it ends at the
 * profile now. `question`, `question_option` and `profile_concern` stay, and every action
 * of the profile assistant that reads them is untouched — what changed is who writes
 * them, and for the length of this plan nothing does. They come back in the slot that
 * reshapes a question for a match against an offer.
 */
describe("a reading writes no question (ID333)", () => {
  it("writes no question and no option for a first reading, whatever its answer proposes", async () => {
    const person = await signedIn("first-reading-writes-no-question@example.com");
    await documentsFor(person.id, three, storage);

    await (await read(person.cookie)).text();

    // The shipped case for these three documents proposes four candidates, and the run
    // takes none of them: not five, not one, none.
    expect(await questionRowsOf(person.id)).toEqual({ questions: 0, options: 0 });
    expect((await profileOf(person.cookie)).questions).toEqual([]);
    // And the profile itself was written: this is a run that worked.
    expect(everyItemOf(await profileOf(person.cookie)).length).toBeGreaterThan(0);
  });

  it("writes no question for a second reading either", async () => {
    const person = await withAProfile("second-reading-writes-no-question@example.com");
    const post = (await profileOf(person.cookie)).experience[0];
    if (post === undefined) throw new Error("the first reading wrote no experience");
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    const cases = withCases({
      [second.case]: {
        content: aSecondReading({
          candidates: [
            {
              kind: "scope",
              item: post.title,
              where: "Experience · in 2 documents",
              lead: "Whose work was the migration?",
              options: [
                { label: "Mine", hint: "I led it", concern: "Led the migration" },
                { label: "In my own words", hint: "I will say it myself" },
              ],
            },
          ],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    // The documents were read — a proposal nothing writes is not a failed reading.
    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_EN.pdf", "read"],
      ["2026-08-30_cv_FR.pdf", "read"],
    ]);
    expect(await questionRowsOf(person.id)).toEqual({ questions: 0, options: 0 });
  });

  /**
   * The tables stay, and a fourth kind is still impossible at rest: the column is an enum
   * of exactly three values and PostgreSQL itself refuses a fourth. PGlite is PostgreSQL,
   * so this is the same refusal the deployed cluster makes.
   *
   * Moved here from `intake-questions` by `S3.1`. Its subject is the schema this plan
   * keeps, not the writing it removes, so it outlives that suite.
   */
  it("keeps the question tables, and the database still refuses a fourth kind", async () => {
    const { sql } = await import("drizzle-orm");

    await expect(testDb.execute(sql`select count(*) from question`)).resolves.toBeDefined();
    await expect(testDb.execute(sql`select count(*) from question_option`)).resolves.toBeDefined();
    await expect(testDb.execute(sql`select count(*) from profile_concern`)).resolves.toBeDefined();
    await expect(testDb.execute(sql`select 'scope'::question_kind`)).resolves.toBeDefined();

    // Drizzle wraps the driver's error, so the whole chain is read and not the top
    // message, as `isDuplicate` reads one in the handlers for the same reason.
    const thrown: unknown = await testDb
      .execute(sql`select 'date'::question_kind`)
      .then(() => null)
      .catch((why: unknown) => why);
    const said: string[] = [];
    for (let cause = thrown; cause instanceof Error; cause = cause.cause) said.push(cause.message);
    expect(said.join(" ")).toMatch(/invalid input value for enum question_kind/i);
  });
});

/**
 * The messages of one recorded request, as `lib/ai` put them on the wire.
 *
 * What a reading is asked is a claim this slice makes twice — the first prompt unchanged,
 * and a second one shown the profile — so it is read from the request itself rather than
 * from the module that wrote it.
 */
const messagesOf = (at: number): { role: string; content: string }[] =>
  (requestsSent()[at]?.body as { messages?: { role: string; content: string }[] } | undefined)
    ?.messages ?? [];

/** A person whose English CV has been read: a profile, its questions, and nothing unread. */
const withAProfile = async (email: string) => {
  const person = await signedIn(email);
  await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
  await (await read(person.cookie)).text();
  return person;
};

/**
 * A reading adds to a profile that already has one (`ID308`, `D38`).
 *
 * The whole of this slice is here: a person with nothing is read exactly as before, and a
 * person with a profile is read by a second prompt whose answer can only add. What the
 * person and the agent built — the ids, the lines, the concerns, the questions — is not
 * something a reading can touch, and the shape of the answer is what makes that true
 * rather than the care of whoever wrote the prompt.
 *
 * The second reading's answer is written here with `model.use` rather than taken from a
 * shipped recording: the project ships one second reading, of the ownership CV (`ID317`),
 * and a case for any other document would stand for a run nobody has made (`D20`). The
 * shipped one is walked in the describe that closes this file.
 */
describe("a reading of a person who already has a profile (ID308, D38)", () => {
  it("asks the prompt that creates a profile when there is none, as it always did", async () => {
    const person = await signedIn("first-reading-unchanged@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();

    const [system, human] = messagesOf(0);
    expect(system?.content).toBe(
      "You read everything a job seeker has handed over, given as one document whose parts are marked <<<DOCUMENT name>>> … <<<END>>>, and you write their profile and the questions it leaves open. Answer with JSON alone, as an object with items and candidates. Each item has kind, one of summary, identity, experience, project, education, publication, language, group, entry; title; the optional subtitle, start_text and end_text as the documents wrote them; the block for its kind (experience, project, education, entry); lines; children; and sources. A source is the name of the part the fact came from and what that part said, word for word in that part's own language. A fact stated by several parts carries one source per part and no third wording of your own. Never state a figure no part states: no duration, no seniority, no total. Each candidate is a question the documents themselves cannot answer, with kind, one of scope (a fact says what was done but not what the person's part was), conflict (two parts state the same thing differently) or provenance (a term appears in a way that leaves its standing unclear); item, the exact title of the item it is about; where, the item's place said the way the profile says it; lead, the question itself in one or two sentences; and options, two to four answers, each with label, hint and the concern that answer writes, the last of which is the person's own words and carries no concern. Never ask about a fact the parts agree on and state plainly, never ask about a date a part states, and never ask what a person can be assumed to know about their own job.",
    );
    // The composed document alone: nothing is put in front of it for a person who has no
    // profile to be shown.
    expect(human?.content.startsWith("<<<DOCUMENT 2026-08-30_cv_EN>>>")).toBe(true);
  });

  /**
   * The two readings are two steps, and the call says which one it is (`ID315`).
   *
   * `intake.read` creates a profile and `intake.read-more` adds to one, so the header a
   * run carries names the step it really is. Nothing here is for a double's benefit: this
   * asserts the name the client puts on the wire, which is the same name whatever answers
   * it.
   */
  it("carries intake.read on the first reading and intake.read-more on the second", async () => {
    const person = await withAProfile("the-two-cases@example.com");
    const first = requestsSent().map((request) => request.headers["x-jobapp-case"]);
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    forgetRequests();
    const cases = withCases({ [second.case]: { content: nothingNew } });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(first).toEqual(["intake.read:2026-08-30_cv_EN"]);
    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read-more:2026-08-30_cv_FR",
    ]);
  });

  it("is shown the profile with its ids, and then only the document nobody has read", async () => {
    const person = await withAProfile("second-reading-request@example.com");
    const before = await profileOf(person.cookie);
    const post = before.experience[0];
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    forgetRequests();
    const cases = withCases({ [second.case]: { content: nothingNew } });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const [system, human] = messagesOf(0);
    expect(system?.content).toContain("you answer with what is new in them and nothing else");
    // The profile as `read_profile` answers it: every item by its id, so an addition can
    // name one. Then the composed document of what is unread, and nothing else — the CV
    // that was read is in the profile above, and its file is not there to be read again.
    expect(human?.content.startsWith("<<<PROFILE>>>")).toBe(true);
    expect(human?.content).toContain(`"id": "${post?.id}"`);
    expect(human?.content).toContain("<<<DOCUMENT 2026-08-30_cv_FR>>>");
    expect(human?.content).not.toContain("<<<DOCUMENT 2026-08-30_cv_EN>>>");
  });

  /**
   * The questions and the concern this case needs are written by the suite's own fixture
   * (`S3.0`) and no longer by the reading (`S3.1`, `ID333`). They are the precondition
   * here and not the subject: what is asserted is that a second reading leaves them —
   * and everything else the person was holding — exactly where they were.
   */
  it("leaves every item, line, concern and question the person already had", async () => {
    const person = await withAProfile("second-reading-keeps-everything@example.com");
    await withQuestions(person.id);
    const asked = (await profileOf(person.cookie)).questions[0];
    if (asked === undefined) throw new Error("the fixture wrote no question");
    const answered = await app.request("/api/conversations/profile/actions/answer_question", {
      method: "POST",
      headers: { cookie: person.cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId: asked.id, words: "I wrote it, nobody else did" }),
    });
    expect(answered.status).toBe(200);
    const before = await profileOf(person.cookie);
    const post = before.experience[0];
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    forgetRequests();
    const cases = withCases({
      [second.case]: {
        content: aSecondReading({
          items: [
            {
              kind: "education",
              title: "A certificate of employment",
              education: { institution: "HEIG-VD" },
              sources: saidByTheFrenchCv("Certificat de travail, HEIG-VD."),
            },
          ],
          extends: [
            {
              itemId: post?.id,
              lines: [
                {
                  text: "Led the migration to Kubernetes.",
                  sources: saidByTheFrenchCv("Led the migration to Kubernetes."),
                },
              ],
            },
          ],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const after = await profileOf(person.cookie);
    for (const was of everyItemOf(before)) {
      const now = everyItemOf(after).find((each) => each.id === was.id);
      expect(now?.title).toBe(was.title);
      // The lines it had, as it had them, with their ids: a new line is appended after
      // them and no line is rewritten or renumbered.
      expect(now?.lines.slice(0, was.lines.length)).toEqual(was.lines);
      expect(now?.concerns).toEqual(was.concerns);
    }
    expect(after.questions).toEqual(before.questions);
    // And the concern the person settled by answering is one of the concerns kept.
    expect(everyItemOf(before).find((item) => item.id === asked.itemId)?.concerns).not.toHaveLength(
      0,
    );
  });

  /**
   * The second reading is shown no concern (`ID333`, this slice).
   *
   * The profile it is given used to carry what the person had settled, so the prompt
   * could tell it not to ask about those again. Nothing a reading does produces a concern
   * any more and a reading asks nothing, so carrying them would be handing a model the
   * person's own words for no purpose it has. They stay on the profile, where the
   * assistant reads them.
   */
  it("shows the second reading nothing the person has settled, and asks it for no question", async () => {
    const person = await withAProfile("second-reading-without-concerns@example.com");
    await withQuestions(person.id);
    const asked = (await profileOf(person.cookie)).questions[0];
    if (asked === undefined) throw new Error("the fixture wrote no question");
    const answered = await app.request("/api/conversations/profile/actions/answer_question", {
      method: "POST",
      headers: { cookie: person.cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId: asked.id, words: "I wrote it, nobody else did" }),
    });
    expect(answered.status).toBe(200);
    // The concern is really there: the claim below is about what the request carries, not
    // about a profile that happens to hold nothing.
    const kept = everyItemOf(await profileOf(person.cookie)).flatMap((item) => item.concerns);
    expect(
      kept.filter((concern) => concern.text.includes("I wrote it, nobody else did")),
    ).not.toEqual([]);

    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    forgetRequests();
    const cases = withCases({ [second.case]: { content: nothingNew } });
    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const [system, human] = messagesOf(0);
    expect(human?.content).not.toContain("I wrote it, nobody else did");
    expect(human?.content).not.toContain("concern");
    // And the prompt neither mentions a concern nor asks for a question of any kind.
    expect(system?.content).not.toMatch(/concern|candidate|question/i);
  });

  it("lands a new item after the last, a new line after the item's last, a new child after its last", async () => {
    const person = await withAProfile("second-reading-adds@example.com");
    const before = await profileOf(person.cookie);
    const post = before.experience[0];
    const group = before.groups[0];
    if (post === undefined || group === undefined) throw new Error("the first reading wrote none");
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    const cases = withCases({
      [second.case]: {
        content: aSecondReading({
          items: [
            {
              kind: "education",
              title: "A certificate of employment",
              education: { institution: "HEIG-VD" },
              sources: saidByTheFrenchCv("Certificat de travail, HEIG-VD."),
            },
          ],
          extends: [
            {
              itemId: post.id,
              lines: [
                {
                  text: "Led the migration to Kubernetes.",
                  sources: saidByTheFrenchCv("Led the migration to Kubernetes."),
                },
              ],
            },
            {
              itemId: group.id,
              children: [
                {
                  kind: "entry",
                  title: "Terraform",
                  entry: { label: "Terraform" },
                  sources: saidByTheFrenchCv("Terraform"),
                },
              ],
            },
          ],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const after = await profileOf(person.cookie);
    expect(after.education.at(-1)?.title).toBe("A certificate of employment");
    const extended = after.experience.find((each) => each.id === post.id);
    expect(extended?.lines).toHaveLength(post.lines.length + 1);
    expect(extended?.lines.at(-1)?.text).toBe("Led the migration to Kubernetes.");
    const grown = after.groups.find((each) => each.id === group.id);
    expect(grown?.children).toHaveLength(group.children.length + 1);
    expect(grown?.children.at(-1)?.title).toBe("Terraform");
  });

  it("writes nothing and deletes nothing when an extends names an item that is not theirs", async () => {
    const other = await withAProfile("someone-elses-item@example.com");
    const theirItem = (await profileOf(other.cookie)).experience[0];
    const person = await withAProfile("extends-what-is-not-theirs@example.com");
    const before = await profileOf(person.cookie);
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    const cases = withCases({
      [second.case]: {
        content: aSecondReading({
          extends: [
            {
              itemId: theirItem?.id,
              lines: [
                { text: "A line on a stranger's post.", sources: saidByTheFrenchCv("A line.") },
              ],
            },
          ],
        }),
      },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_EN.pdf", "read"],
      ["2026-08-30_cv_FR.pdf", "failed"],
    ]);
    expect(await profileOf(person.cookie)).toEqual(before);
    // The failed run took nothing with it: the document it could not use still has its file.
    expect(objectsHeld(storage)).toContain(`u/${person.id}/${second.id}`);
  });

  it("is a successful reading when the documents add nothing at all", async () => {
    const person = await withAProfile("second-reading-adds-nothing@example.com");
    const before = await profileOf(person.cookie);
    const second = await oneMore(person.cookie, theSet.cvFrench.filename);
    const cases = withCases({ [second.case]: { content: nothingNew } });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_EN.pdf", "read"],
      ["2026-08-30_cv_FR.pdf", "read"],
    ]);
    // Read and disposed of, and the profile exactly as it was — but for `readOn`, which
    // is when this person's documents were last read, and a reading did just happen
    // (`ID334`: it used to be the last read of a document some fact cited, and no fact
    // cites one any more).
    expect(objectsHeld(storage)).toEqual([]);
    const after = await profileOf(person.cookie);
    expect({ ...after, readOn: null }).toEqual({ ...before, readOn: null });
    expect(Date.parse(after.readOn ?? "")).toBeGreaterThan(Date.parse(before.readOn ?? ""));
  });
});

/**
 * Walk 2, at the route rather than in a browser (SL11, `ID315`, `ID316`, `ID317`).
 *
 * Every other second reading in this file is answered by `model.use`, because its id is
 * chosen by the test. This one is answered by the recording the project *ships*, and that
 * is the whole claim: a file written last week names ids that did not exist when it was
 * written, and it names the person's own because `quoting` reads them back out of the
 * request the run just sent (`ID316`). An expression written against a guess at the JSON
 * instead of against the real request would leave `{{post}}` standing, and the run would
 * fail rather than write it — so this passing is what says the expressions are right.
 */
describe("the shipped second reading of the ownership CV (SL11)", () => {
  it("extends the profile's own items, every id quoted out of the request it answers", async () => {
    const person = await withAProfile("shipped-second-reading@example.com");
    const before = await profileOf(person.cookie);
    const second = await oneMore(person.cookie, theSet.cvOwnership.filename);
    expect(second.case).toBe("intake.read-more:2026-09-09_cv-en_ownership-application-management");

    await (await read(person.cookie)).text();

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_EN.pdf", "read"],
      ["2026-09-09_cv-en_ownership-application-management.pdf", "read"],
    ]);
    const after = await profileOf(person.cookie);
    // Nothing the first reading wrote was replaced: every id, title, line and concern is
    // where it was, and the additions are behind them.
    for (const was of everyItemOf(before)) {
      const now = everyItemOf(after).find((each) => each.id === was.id);
      expect(now?.title).toBe(was.title);
      expect(now?.lines.slice(0, was.lines.length)).toEqual(was.lines);
      expect(now?.concerns).toEqual(was.concerns);
    }
    expect(everyItemOf(after).length).toBeGreaterThan(everyItemOf(before).length);
    // What the ownership CV adds, in both of its kinds: an item the profile did not hold
    // at all, and new lines on items the first reading wrote.
    expect(after.groups.map((group) => group.title)).toContain("Operations and support");
    const grew = everyItemOf(after).filter((now) => {
      const was = everyItemOf(before).find((each) => each.id === now.id);
      return was !== undefined && now.lines.length > was.lines.length;
    });
    expect(grew.length).toBeGreaterThan(1);
  });
});

/**
 * A document is an input that is consumed (`ID309`, `D38`).
 *
 * Read, its facts placed in the profile, its file disposed of — never before the profile
 * is committed. What stays is the row: when it was read, and the hash that makes the same
 * bytes handed over twice a duplicate still.
 */
describe("a document consumed by the reading (ID309)", () => {
  it("deletes each read document's file and clears its key, keeping the row", async () => {
    const person = await signedIn("consumed-after-reading@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    expect(objectsHeld(storage)).toHaveLength(1);

    await (await read(person.cookie)).text();

    const [row] = await rowsOf(person.id);
    expect(objectsHeld(storage)).toEqual([]);
    expect([row?.status, row?.storageKey]).toEqual(["read", null]);
    expect(row?.readAt).not.toBeNull();
    // The profile the run wrote is there although the file it was written from is gone.
    const profile = await profileOf(person.cookie);
    expect(profile.experience.length).toBeGreaterThan(0);
    expect(profile.readOn).not.toBeNull();
  });

  it("deletes nothing when the reading fails", async () => {
    const person = await signedIn("nothing-consumed-on-failure@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    const cases = withCases({
      "intake.read:2026-08-30_cv_EN": { content: "No pre generated text" },
    });

    try {
      await (await read(person.cookie)).text();
    } finally {
      cases.dispose();
    }

    const [row] = await rowsOf(person.id);
    expect(row?.status).toBe("failed");
    expect(row?.storageKey).not.toBeNull();
    expect(objectsHeld(storage)).toHaveLength(1);
  });

  /**
   * The profile is written by the time the files go, so a storage that will not delete is
   * a thing to log and nothing else: a run that failed here would tell the person their
   * documents could not be read, which is not what happened.
   */
  it("logs a file that will not go and still ends the run as done", async () => {
    const person = await signedIn("a-file-that-will-not-go@example.com");
    await documentsFor(person.id, [theSet.cvEnglish.filename], storage);
    const refusing = {
      put: (key: ObjectKey, object: StoredObject) => storage.put(key, object),
      get: (key: ObjectKey) => storage.get(key),
      delete: (key: ObjectKey) => Promise.reject(new Error(`the object will not delete: ${key}`)),
    } satisfies Storage;
    objects.storage = refusing;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const leaves = leavesOf(await (await read(person.cookie)).text());

      expect(leaves.at(-1)).toEqual(expect.objectContaining({ kind: "run", status: "done" }));
      const [row] = await rowsOf(person.id);
      expect(row?.status).toBe("read");
      expect(logged).toHaveBeenCalledOnce();
      // The key stays on the row when the file would not go, so the object is still named
      // by something and the account's deletion takes it.
      expect(row?.storageKey).not.toBeNull();
    } finally {
      objects.storage = storage;
      logged.mockRestore();
    }
  });
});

describe("a typed address in a run (US2, F5)", () => {
  it("is marked read without a call, because nothing is fetched and so nothing reads it", async () => {
    const person = await signedIn("address-in-a-run@example.com");
    await app.request("/api/intake/documents", {
      method: "POST",
      headers: { cookie: person.cookie },
      body: (() => {
        const body = new FormData();
        body.set("address", "linkedin.com/in/someone");
        return body;
      })(),
    });

    await (await read(person.cookie)).text();

    expect(requestsSent()).toEqual([]);
    expect(await statusesOf(person.id)).toEqual([["linkedin.com/in/someone", "read"]]);
  });
});
