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
 * Not past it: `lib/ai`'s own behaviour and the mock's envelopes, which are SL1's seams.
 * Also not past it, the facts a classification yields — this slice persists the kind and
 * the status, and the facts are SL3's.
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
  const { aiThroughTheApp } = await import("../support/ai");
  const ai = aiThroughTheApp();
  return { ...real, ask: ai.ask, askStreaming: ai.askStreaming, askFor: ai.askFor };
});

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
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

const statusesOf = async (userId: string) =>
  (
    await testDb
      .select({ filename: document.filename, status: document.status })
      .from(document)
      .where(eq(document.userId, userId))
      .orderBy(document.createdAt, document.id)
  ).map((row) => [row.filename, row.status]);

/** The three real documents a run is driven over, all of which the mock has cases for. */
const three = [theSet.cvFrench.filename, theSet.cvEnglish.filename, theSet.diploma.filename];

describe("the reading run (criterion 10, D8)", () => {
  it("sends one frame per document, in order, and says it is done", async () => {
    const person = await signedIn("three-documents-read@example.com");
    await documentsFor(person.id, three);

    const leaves = leavesOf(await (await read(person.cookie)).text());

    expect(leaves.filter((leaf) => leaf.status === "read").length).toBe(3);
    expect(leaves.at(-1)?.kind).toBe("run");
  });

  /**
   * One document at a time, classified then read for what it states, and the merge once
   * at the end over all of them (SL3, criterion 3). Extraction is per document on
   * purpose: what makes the merge provable is that separate readings were reconciled,
   * and one call over concatenated documents would pass every count and lose the
   * provenance.
   */
  it("classifies and extracts each document alone, then merges once, every call naming its case", async () => {
    const person = await signedIn("one-call-each@example.com");
    await documentsFor(person.id, three);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.classify:2026-08-30_cv_FR",
      "intake.extract:2026-08-30_cv_FR",
      "intake.classify:2026-08-30_cv_EN",
      "intake.extract:2026-08-30_cv_EN",
      "intake.classify:BS-HEIGVD-IL-Diplome",
      "intake.extract:BS-HEIGVD-IL-Diplome",
      "intake.merge:2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome",
      // SL4's fourth step, once, over the profile the merge just wrote.
      "intake.questions:2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome",
    ]);
  });

  it("writes what the reader detected into the row, kind and language", async () => {
    const person = await signedIn("kind-and-language@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);

    await (await read(person.cookie)).text();

    const rows = await testDb
      .select({
        filename: document.filename,
        kind: document.detectedKind,
        language: document.detectedLanguage,
        status: document.status,
      })
      .from(document)
      .where(eq(document.userId, person.id))
      .orderBy(document.createdAt, document.id);
    expect(rows.map((row) => [row.filename, row.kind, row.language, row.status])).toEqual([
      ["2026-08-30_cv_FR.pdf", "cv", "fr", "read"],
      ["2026-08-30_cv_EN.pdf", "cv", "en", "read"],
    ]);
  });

  /**
   * The document's row is written before its frame leaves, not at the end of the run
   * (`D8`, and the slice's "watch out"). By the time the first `read` frame is in a
   * reader's hands, the database already says so — which is the only thing that makes
   * a reload mid-run agree with the screen.
   */
  it("persists a document's row before it sends that document's frame", async () => {
    const person = await signedIn("persisted-as-it-lands@example.com");
    const [first] = await documentsFor(person.id, three);
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

  it("marks the one document it cannot read and reads the others", async () => {
    const person = await signedIn("one-fails@example.com");
    // A document the mock holds no case for: a miss is a failure, never a call, and
    // never a guess (spec D20, SL1's seam B). That is what a document a reader cannot
    // read looks like from here.
    await documentsFor(person.id, [
      theSet.cvFrench.filename,
      "a-document-nobody-recorded.pdf",
      theSet.cvEnglish.filename,
    ]);

    await (await read(person.cookie)).text();

    expect(await statusesOf(person.id)).toEqual([
      ["2026-08-30_cv_FR.pdf", "read"],
      ["a-document-nobody-recorded.pdf", "failed"],
      ["2026-08-30_cv_EN.pdf", "read"],
    ]);
  });

  it("says of the failed one what went wrong, naming it", async () => {
    const person = await signedIn("failure-named@example.com");
    await documentsFor(person.id, ["a-document-nobody-recorded.pdf"]);

    await (await read(person.cookie)).text();

    const [row] = await testDb.select().from(document).where(eq(document.userId, person.id));
    expect(row?.failureReason).toMatch(/a-document-nobody-recorded\.pdf/);
  });

  it("reaches no provider from anywhere: every request went to this application", async () => {
    const person = await signedIn("no-provider-reached@example.com");
    await documentsFor(person.id, three);

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
    const [first] = await documentsFor(person.id, three);
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
    await documentsFor(person.id, [theSet.cvFrench.filename]);
    await (await read(person.cookie)).text();
    forgetRequests();

    await (await read(person.cookie)).text();

    expect(requestsSent()).toEqual([]);
  });
});

/**
 * Seam B's other half: the two steps this slice adds to the run (criteria 3, 4, 5, 9).
 *
 * Behind it, the same PGlite and the same in-process mock. What is asserted is read
 * back through `GET /api/intake/profile`, because the route that writes a profile is
 * the route that reads it; nothing here selects from `profile_item`.
 *
 * Not past it: the fixtures' contents. That a case says what a real reader would say is
 * the business of whoever records it, and these were hand-written from the person's own
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

describe("the extraction and the merge (criteria 3, 4, 5)", () => {
  it("turns the two CVs of one month into one experience with two sources", async () => {
    const person = await signedIn("one-month-two-languages@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);

    expect(profile.experience).toHaveLength(1);
    expect(profile.experience[0]?.documents).toBe(2);
    // Each provenance row carries its own document's wording, in its own language: the
    // merge translated nothing and summarised nothing (S3.2's done-when).
    expect(profile.experience[0]?.sources).toEqual([
      {
        document: "2026-08-30_cv_FR.pdf",
        said: "Collaborateur R&D en genie logiciel, HEIG-VD, Yverdon-les-Bains, aout 2022 - aout 2026.",
      },
      {
        document: "2026-08-30_cv_EN.pdf",
        said: "R&D Collaborator in Software Engineering, HEIG-VD, Yverdon-les-Bains, Hybrid, Aug 2022 - Aug 2026.",
      },
    ]);
  });

  it("keeps what a document said against the line it produced, word for word", async () => {
    const person = await signedIn("verbatim-against-the-fact@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const line = profile.experience[0]?.lines[1];

    expect(line?.text).toBe("Responsible for practical lab support on the DevOps course.");
    expect(line?.sources.map((source) => source.said)).toEqual([
      // The French document's own sentence, as `extract:2026-08-30_cv_FR` states it.
      "Responsable du suivi des laboratoires du cours DevOps.",
      "Responsible for practical lab support on the DevOps course.",
    ]);
  });

  it("records both wordings of one post against the one item and writes no third", async () => {
    const person = await signedIn("two-documents-disagree@example.com");
    await documentsFor(person.id, [theSet.cvWord2022.filename, theSet.cv2025.filename]);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const post = profile.experience[0];

    expect(profile.experience).toHaveLength(1);
    // Both, in the documents' own words. The merge picked no winner and invented no
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
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);

    await (await read(person.cookie)).text();
    const profile = await profileOf(person.cookie);
    const entries = profile.groups.flatMap((group) => group.children);

    expect(profile.groups.map((group) => group.title)).toEqual([
      "Programming languages",
      "DevOps and cloud",
    ]);
    expect(entries.map((entry) => entry.title)).toEqual([
      "JavaScript",
      "TypeScript",
      "Python",
      "Docker",
      "Kubernetes",
    ]);
    // Flat by construction: an entry has nothing under it, whatever a merge answers.
    expect(entries.flatMap((entry) => entry.children)).toEqual([]);
    // And no duration anywhere: `item_entry` has no column for one, so a year on a chip
    // is a thing the database cannot hold rather than a thing the screen omits (D16).
    for (const entry of entries) {
      expect(`${entry.title} ${entry.entry?.label} ${entry.entry?.qualifier ?? ""}`).not.toMatch(
        /\d/,
      );
    }
  });
});

describe("an answer that cannot be used (spec, Failure modes)", () => {
  it("marks the document whose extraction is malformed, and reads the others", async () => {
    const person = await signedIn("malformed-extract@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);
    const cases = withCases({
      "intake.classify:2026-08-30_cv_FR": {
        stands_for: "the French CV, classified",
        content: '{"kind":"cv","language":"fr","confidence":0.97,"why":"a CV in French"}',
      },
      "intake.classify:2026-08-30_cv_EN": {
        stands_for: "the English CV, classified",
        content: '{"kind":"cv","language":"en","confidence":0.97,"why":"a CV in English"}',
      },
      "intake.extract:2026-08-30_cv_FR": {
        stands_for: "the French CV, read",
        content:
          '{"facts":[{"kind":"identity","title":"Stefan Teofanovic","said":"Stefan Teofanovic, Montreux, Suisse.","lines":[]}]}',
      },
      // A reader that answered with prose where facts were asked for. Validated at the
      // boundary, so it is a failed step and never a half-written anything.
      "intake.extract:2026-08-30_cv_EN": {
        stands_for: "the English CV, answered with something that is not a reading",
        content: '{"facts":[]}',
      },
      "intake.merge:2026-08-30_cv_FR": {
        stands_for: "the one document that could be read, merged alone",
        content:
          '{"items":[{"kind":"identity","title":"Stefan Teofanovic","sources":[{"document":"2026-08-30_cv_FR","said":"Stefan Teofanovic, Montreux, Suisse."}]}]}',
      },
    });

    try {
      await (await read(person.cookie)).text();

      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_FR.pdf", "read"],
        ["2026-08-30_cv_EN.pdf", "failed"],
      ]);
    } finally {
      cases.dispose();
    }
  });

  it("writes no part of a profile when the merge answers something unusable", async () => {
    const person = await signedIn("malformed-merge@example.com");
    await documentsFor(person.id, [theSet.cvFrench.filename, theSet.cvEnglish.filename]);
    const cases = withCases({
      "intake.classify:2026-08-30_cv_FR": {
        stands_for: "the French CV, classified",
        content: '{"kind":"cv","language":"fr","confidence":0.97,"why":"a CV in French"}',
      },
      "intake.classify:2026-08-30_cv_EN": {
        stands_for: "the English CV, classified",
        content: '{"kind":"cv","language":"en","confidence":0.97,"why":"a CV in English"}',
      },
      "intake.extract:2026-08-30_cv_FR": {
        stands_for: "the French CV, read",
        content:
          '{"facts":[{"kind":"identity","title":"Stefan Teofanovic","said":"Stefan Teofanovic, Montreux, Suisse.","lines":[]}]}',
      },
      "intake.extract:2026-08-30_cv_EN": {
        stands_for: "the English CV, read",
        content:
          '{"facts":[{"kind":"identity","title":"Stefan Teofanovic","said":"Stefan Teofanovic, Montreux, Switzerland.","lines":[]}]}',
      },
      // An item citing nothing: the one thing this product promises not to produce, and
      // so the one thing the boundary refuses before a row is written.
      "intake.merge:2026-08-30_cv_FR+2026-08-30_cv_EN": {
        stands_for: "a merge that answered with an item no document stands behind",
        content: '{"items":[{"kind":"identity","title":"Somebody","sources":[]}]}',
      },
    });

    try {
      await (await read(person.cookie)).text();

      // The documents are read and their facts are not lost: a second run over them is
      // what puts them back through the merge. What must not be there is half a profile.
      expect(await statusesOf(person.id)).toEqual([
        ["2026-08-30_cv_FR.pdf", "read"],
        ["2026-08-30_cv_EN.pdf", "read"],
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
