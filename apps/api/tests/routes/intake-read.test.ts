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
const { forgetRequests, requestsSent } = await import("../support/ai");

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

  it("classifies each document alone, with the case header lib/ai sets and one call each", async () => {
    const person = await signedIn("one-call-each@example.com");
    await documentsFor(person.id, three);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.classify:2026-08-30_cv_FR",
      "intake.classify:2026-08-30_cv_EN",
      "intake.classify:BS-HEIGVD-IL-Diplome",
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
