import { document } from "@app/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectKey, Storage, StoredObject } from "../../src/lib/storage";
import { subjectAt } from "../support/providers";
import { localStorageIn, objectsHeld } from "../support/storage";

/**
 * Seam B: `routes/intake`, its document routes, driven through `app.request`
 * (criteria 4, 5, 6, 7, 13).
 *
 * Behind the seam: PostgreSQL in process on PGlite, `lib/storage`'s directory
 * implementation on a temporary directory, and a signed-in session produced by the
 * library's own round trip. Nothing is past it: what landed is read back through the
 * list route, which is the interface that wrote it, and no case looks in a table or in
 * the storage directory.
 *
 * The documents are the person's own, committed as fixtures (`D20`). What a case about
 * size uploads is bytes rather than a file, because no document the person has is over
 * the limit and the limit is about a number.
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

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { bytesOfFixture, fiveOfThem, theSet, uploadOf, uploadOfAddress, uploadOfFixture } =
  await import("../support/documents");
const { env } = await import("../../src/env");
const { keyFor } = await import("../../src/lib/storage");

let storage: ReturnType<typeof localStorageIn>;

beforeEach(() => {
  storage = localStorageIn();
  objects.storage = storage;
});

afterEach(() => {
  storage.dispose();
  vi.unstubAllGlobals();
});

/** A person signed in, and the cookie every request of theirs carries. */
const signedIn = async (email: string) => {
  const response = await signInThrough("google", {
    subject: subjectAt("google", email),
    name: "Someone Seeking",
    email,
    emailVerified: true,
  });
  const user = await signedInAs(response);
  if (user === null) throw new Error(`the sign-in for ${email} produced no session`);
  // The provider's doors are only needed for the round trip; the intake reaches nothing.
  vi.unstubAllGlobals();
  return { id: user.id, cookie: cookiesSetBy(response) };
};

const post = (cookie: string, body: FormData) =>
  app.request("/api/intake/documents", { method: "POST", headers: { cookie }, body });

const list = (cookie: string) => app.request("/api/intake/documents", { headers: { cookie } });

type Row = {
  id: string;
  filename: string;
  source: string;
  address: string | null;
  detectedKind: string | null;
  status: string;
};

const rowsOf = async (response: Response): Promise<Row[]> => (await response.json()) as Row[];

describe("the documents a person hands over (US1, criterion 4)", () => {
  it("takes five of the person's own documents in one gesture, each with the kind it was detected as", async () => {
    const person = await signedIn("five-documents@example.com");

    for (const each of fiveOfThem) {
      const response = await post(person.cookie, uploadOfFixture(each.filename));
      expect([each.filename, response.status]).toEqual([each.filename, 201]);
    }

    const listed = await rowsOf(await list(person.cookie));
    expect(listed.map((row) => [row.filename, row.detectedKind, row.status])).toEqual([
      ["2026-08-30_cv_FR.pdf", "cv", "waiting"],
      ["2026-08-30_cv_EN.pdf", "cv", "waiting"],
      ["leCVWeb.docx", "cv", "waiting"],
      ["CV-2025.pdf", "cv", "waiting"],
      ["BS-HEIGVD-IL-Diplome.pdf", "diploma", "waiting"],
    ]);
  });

  it("puts the bytes in storage and the key in the database, never the bytes", async () => {
    const person = await signedIn("bytes-in-storage@example.com");

    const created = (await (
      await post(person.cookie, uploadOfFixture(theSet.diploma.filename))
    ).json()) as Row;

    const [row] = await testDb.select().from(document).where(eq(document.id, created.id));
    expect(row?.storageKey).toBe(`u/${person.id}/${created.id}`);
    expect(objectsHeld(storage)).toEqual([`u/${person.id}/${created.id}`]);
    // Every column of the row, and not one of them holds a byte of the document.
    expect(Object.values(row ?? {}).some((value) => value instanceof Uint8Array)).toBe(false);
  });

  it("removes a row and takes its object with it", async () => {
    const person = await signedIn("remove-one@example.com");
    const created = (await (
      await post(person.cookie, uploadOfFixture(theSet.cvFrench.filename))
    ).json()) as Row;

    const removed = await app.request(`/api/intake/documents/${created.id}`, {
      method: "DELETE",
      headers: { cookie: person.cookie },
    });

    expect(removed.status).toBe(200);
    expect(await rowsOf(await list(person.cookie))).toEqual([]);
    expect(objectsHeld(storage)).toEqual([]);
  });

  /**
   * A document the reading has consumed has no file and no key (`ID309`), and taking its
   * row back still works: the removal asks the storage for nothing when there is nothing
   * to ask for. The row is what a fact cites, so removing it takes the provenance with it
   * through the foreign key, as it always did.
   */
  it("removes a document whose file the reading already took, without asking the storage", async () => {
    const person = await signedIn("remove-one-already-read@example.com");
    const created = (await (
      await post(person.cookie, uploadOfFixture(theSet.cvFrench.filename))
    ).json()) as Row;
    await testDb
      .update(document)
      .set({ status: "read", readAt: new Date(), storageKey: null })
      .where(eq(document.id, created.id));
    // The file is gone the way a reading leaves it gone: the row alone is what is removed.
    await storage.delete(keyFor(person.id, created.id));
    const asked: string[] = [];
    objects.storage = {
      put: (key: ObjectKey, object: StoredObject) => storage.put(key, object),
      get: (key: ObjectKey) => storage.get(key),
      delete: (key: ObjectKey) => {
        asked.push(key);
        return storage.delete(key);
      },
    } satisfies Storage;

    try {
      const removed = await app.request(`/api/intake/documents/${created.id}`, {
        method: "DELETE",
        headers: { cookie: person.cookie },
      });

      expect(removed.status).toBe(200);
      expect(await rowsOf(await list(person.cookie))).toEqual([]);
      expect(asked).toEqual([]);
    } finally {
      objects.storage = storage;
    }
  });
});

describe("the same document twice (criterion 5)", () => {
  it("refuses the second one by content hash, with a line saying it is already there", async () => {
    const person = await signedIn("same-bytes-twice@example.com");
    const first = (await (
      await post(person.cookie, uploadOfFixture(theSet.cvEnglish.filename))
    ).json()) as Row;

    // The same bytes under another name: what is refused is the document, not the name.
    const again = await post(
      person.cookie,
      uploadOf(bytesOfFixture(theSet.cvEnglish.filename), "a-copy-of-the-same-cv.pdf"),
    );

    expect(again.status).toBe(409);
    expect((await again.json()) as { error: string }).toEqual({
      error: "2026-08-30_cv_EN.pdf is already here.",
      documentId: first.id,
    });
  });

  it("writes no second object, so the refusal costs nothing in storage", async () => {
    const person = await signedIn("no-second-object@example.com");
    await post(person.cookie, uploadOfFixture(theSet.cvFrench.filename));

    await post(person.cookie, uploadOfFixture(theSet.cvFrench.filename));

    expect(objectsHeld(storage)).toHaveLength(1);
    expect(await rowsOf(await list(person.cookie))).toHaveLength(1);
  });

  /**
   * The duplicate is refused per person, not globally: two people may hold the same
   * public diploma, and refusing the second would be refusing a document to somebody
   * who has never uploaded one (the slice's "watch out").
   */
  it("lets another person upload the very same diploma", async () => {
    const first = await signedIn("first-holder@example.com");
    const second = await signedIn("second-holder@example.com");
    await post(first.cookie, uploadOfFixture(theSet.diploma.filename));

    const theirs = await post(second.cookie, uploadOfFixture(theSet.diploma.filename));

    expect(theirs.status).toBe(201);
    expect(await rowsOf(await list(second.cookie))).toHaveLength(1);
  });
});

describe("an upload over the limit (criterion 6)", () => {
  it("is refused before it starts, with the limit in the message and the file named", async () => {
    const person = await signedIn("too-large@example.com");
    const overTheLimit = new Uint8Array(env.UPLOAD_LIMIT_BYTES + 1);

    const refused = await post(person.cookie, uploadOf(overTheLimit, "a-scan-of-everything.pdf"));

    expect(refused.status).toBe(413);
    expect((await refused.json()) as { error: string }).toEqual({
      error: "a-scan-of-everything.pdf is larger than 5 MB, which is the most I can take.",
    });
  });

  it("writes neither a row nor an object for it", async () => {
    const person = await signedIn("nothing-written@example.com");

    await post(
      person.cookie,
      uploadOf(new Uint8Array(env.UPLOAD_LIMIT_BYTES + 1), "a-scan-of-everything.pdf"),
    );

    expect(await rowsOf(await list(person.cookie))).toEqual([]);
    expect(objectsHeld(storage)).toEqual([]);
  });

  it("takes the largest document the person actually has, which is under it", async () => {
    const person = await signedIn("largest-real-one@example.com");

    const response = await post(person.cookie, uploadOfFixture(theSet.cv2025.filename));

    expect(response.status).toBe(201);
  });
});

describe("a typed LinkedIn address, and no file at all (US2, criterion 7)", () => {
  it("is accepted as a source row with no storage key", async () => {
    const person = await signedIn("address-only@example.com");

    const response = await post(person.cookie, uploadOfAddress("linkedin.com/in/someone"));

    expect(response.status).toBe(201);
    const [row] = await rowsOf(await list(person.cookie));
    expect({ source: row?.source, address: row?.address, filename: row?.filename }).toEqual({
      source: "linkedin_address",
      address: "linkedin.com/in/someone",
      filename: "linkedin.com/in/someone",
    });
  });

  it("puts no object in storage for it, because there are no bytes", async () => {
    const person = await signedIn("address-no-bytes@example.com");

    await post(person.cookie, uploadOfAddress("linkedin.com/in/someone-else"));

    expect(objectsHeld(storage)).toEqual([]);
  });

  it("refuses a request that carries neither a file nor an address", async () => {
    const person = await signedIn("nothing-at-all@example.com");

    const response = await post(person.cookie, new FormData());

    expect(response.status).toBe(400);
  });
});

describe("every route filters by the session's user (criterion 13)", () => {
  it("answers another person's document id with not found, never with their row", async () => {
    const owner = await signedIn("the-owner@example.com");
    const stranger = await signedIn("the-stranger@example.com");
    const theirs = (await (
      await post(owner.cookie, uploadOfFixture(theSet.cvFrench.filename))
    ).json()) as Row;

    const removed = await app.request(`/api/intake/documents/${theirs.id}`, {
      method: "DELETE",
      headers: { cookie: stranger.cookie },
    });

    // 404 and not 403: a 403 would confirm the row exists.
    expect(removed.status).toBe(404);
    expect(await rowsOf(await list(owner.cookie))).toHaveLength(1);
  });

  it("lists a person their own documents and nobody else's", async () => {
    const mine = await signedIn("mine-only@example.com");
    const theirs = await signedIn("theirs-only@example.com");
    await post(mine.cookie, uploadOfFixture(theSet.cvEnglish.filename));
    await post(theirs.cookie, uploadOfFixture(theSet.diploma.filename));

    expect((await rowsOf(await list(mine.cookie))).map((row) => row.filename)).toEqual([
      "2026-08-30_cv_EN.pdf",
    ]);
  });

  it.each([
    ["listing", "GET", "/api/intake/documents"],
    ["uploading", "POST", "/api/intake/documents"],
    ["removing", "DELETE", "/api/intake/documents/whatever"],
  ])("turns %s away with no session at all", async (_what, method, path) => {
    const response = await app.request(path, { method });

    expect(response.status).toBe(401);
  });
});
