import { document } from "@app/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subjectAt } from "../support/providers";
import { localStorageIn } from "../support/storage";

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

/** The three real documents a run is driven over, which the mock has the run's case for. */
const three = [theSet.cvFrench.filename, theSet.cvEnglish.filename, theSet.diploma.filename];

/**
 * A name the suite has no document for, given a media type that holds no characters at
 * all. It stands for the one thing that still fails alone: a file nothing can turn into
 * text, refused before the call rather than by it (`ID157`, `ID159`).
 */
const aPhotograph = "a-photograph-of-a-paper-cv.jpg";

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
  it("makes one call for the whole run, its case naming every document in order", async () => {
    const person = await signedIn("one-call-each@example.com");
    await documentsFor(person.id, three, storage);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome",
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
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN",
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
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN": { content: "No pre generated text" },
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
  kind: string;
  title: string;
  documents: number;
  entry: { label: string; qualifier: string | null } | null;
  lines: { text: string; sources: { document: string; said: string }[] }[];
  children: Item[];
  sources: { document: string; said: string }[];
};

type Profile = {
  documents: number;
  experience: Item[];
  groups: Item[];
  education: Item[];
};

const profileOf = async (cookie: string): Promise<Profile> => {
  const answer = await app.request("/api/intake/profile", { headers: { cookie } });
  return (await answer.json()) as Profile;
};

describe("what one reading of the composed documents writes (criteria 3, 4, 5)", () => {
  /**
   * The claim is not how many posts the CVs state — they state eight, and the profile
   * carries eight. It is that a post **both** documents state is one item citing both,
   * each in its own language, rather than two items or one wording of the reading's own.
   */
  it("gives a post both CVs state one item and a source apiece", async () => {
    const person = await signedIn("one-month-two-languages@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);

    const shared = profile.experience.filter((post) => post.documents === 2);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.title).toBe("R&D Collaborator in Software Engineering");
    // Each provenance row carries its own document's wording, in its own language: the
    // reading translated nothing and summarised nothing (S3.2's done-when). Which row
    // comes first is the reading's order and nothing a person sees, so the claim is
    // about the pair rather than its sequence.
    expect(
      [...(shared[0]?.sources ?? [])].sort((a, b) => a.document.localeCompare(b.document)),
    ).toEqual([
      {
        document: "2026-08-30_cv_EN.pdf",
        said: "R&D Collaborator in Software Engineering - HEIG-VD - University of Applied Sciences, Yverdon-les-Bains, Switzerland (Hybrid), Aug 2022 - Aug 2026.",
      },
      {
        document: "2026-08-30_cv_FR.pdf",
        said: "Collaborateur R&D en genie logiciel, HEIG-VD, Yverdon-les-Bains, aout 2022 - aout 2026.",
      },
    ]);
  });

  it("keeps what a document said against the line it produced, word for word", async () => {
    const person = await signedIn("verbatim-against-the-fact@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const post = profile.experience.find((each) => each.lines.length > 0);
    const lines = post?.lines ?? [];

    // The claim is that a line's provenance is the document's own sentence and not a
    // summary of it — so every line of every post says, word for word, what it carries,
    // and cites the document it came from.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.sources.length).toBeGreaterThan(0);
      for (const source of line.sources) {
        expect(source.said).toBe(line.text);
        expect(source.document).toMatch(/2026-08-30_cv_(EN|FR)\.pdf/);
      }
    }
  });

  it("records both wordings of one post against the one item and writes no third", async () => {
    const person = await signedIn("two-documents-disagree@example.com");
    await documentsFor(person.id, [theSet.cvWord2022.filename, theSet.cv2025.filename], storage);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const post = profile.experience[0];

    expect(profile.experience).toHaveLength(1);
    // Both, in the documents' own words. The reading picked no winner and invented no
    // sentence of its own: what it chose as the title is one of the two the documents
    // state, and everything either of them said is still there to be shown.
    expect(post?.sources.map((source) => source.said)).toEqual([
      "Assistant HES a la HEIG-VD, Yverdon-les-Bains, depuis 2022.",
      "R&D Collaborator in Software Engineering at HEIG-VD, Yverdon-les-Bains, since 2022.",
    ]);
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
const theRunsCase = "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN";

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
      expect(profile.documents).toBe(0);
      expect([...profile.experience, ...profile.groups, ...profile.education]).toEqual([]);
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
      expect(profile.documents).toBe(0);
      expect([...profile.experience, ...profile.groups, ...profile.education]).toEqual([]);
    } finally {
      cases.dispose();
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
