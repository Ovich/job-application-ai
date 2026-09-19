import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectKey, Storage } from "../../../src/lib/storage";
import { subjectAt } from "../../support/providers";
import { localStorageIn } from "../../support/storage";

/**
 * Seam A: `lib/auth`, the library's own `delete-user` route (criteria 9, 10, 11).
 *
 * Behind it: PGlite (`tests/support/database.ts`) and a directory storage on a temporary
 * directory. The seam stays inside the module — nothing here calls `beforeDelete` — and
 * what is read back afterwards is asked of `lib/storage`'s `get` by the key the upload
 * composed, and of the intake's own `profileOf`, never by counting rows in a table the
 * library owns. That sessions, accounts and the user row go is the library's own and is
 * proved by `accounts-login`; it is not re-proved here.
 *
 * The person under test uploads three real documents of the person's own set through the
 * intake's own route, so the object the erasure removes is an object a real upload put
 * (`D20`, the slice's criterion 9), and the question fixture gives them the items, the
 * questions and — once they are answered — the rules to be erased with. One line is
 * written on an item here, so the claim that the lines go is made over a row that existed:
 * `provenance` was the other row hanging off an item and it is gone with `ID334`.
 *
 * **No reading is run here** (`S3.0`). What this file is about is what an erasure takes,
 * and a reading is only one way of putting those rows there; the fixture writes them,
 * which is both faster and one dependency fewer between an erasure and the intake.
 */

const objects = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

vi.mock("../../../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/storage")>()),
  get storage() {
    return objects.storage;
  },
}));

vi.mock("../../../src/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/lib/ai")>();
  const { askForThroughTheApp } = await import("../../support/ai");
  return { ...real, askFor: askForThroughTheApp() };
});

const { testDb } = await import("../../support/database");
const { document, itemLine, profileConcern, profileItem, question } = await import("@app/db");
const { eq } = await import("drizzle-orm");
const { app } = await import("../../../src/app");
const { auth } = await import("../../../src/lib/auth");
const { keyFor } = await import("../../../src/lib/storage");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../../support/sign-in");
const { theSet, uploadOfFixture } = await import("../../support/documents");
const { forgetRequests } = await import("../../support/ai");
const { profileOf } = await import("../../../src/handlers/profile");
const { withQuestions } = await import("../../support/questions");

const appUrl = "http://localhost:4200";

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

/** The two real CVs criterion 9 names, uploaded the way a browser uploads them. */
const twoRealCvs = [theSet.cvFrench.filename, theSet.cvEnglish.filename] as const;

/**
 * A person with everything this slice erases: three uploaded documents, each still holding
 * its object, a profile of items cited by them, the questions a reading would have left
 * them, and two profile concerns, each kept by an answer.
 */
const aPersonWithAProfile = async (email: string) => {
  const person = await signedIn(email);
  for (const filename of twoRealCvs) {
    await app.request("/api/intake/documents", {
      method: "POST",
      headers: { cookie: person.cookie },
      body: uploadOfFixture(filename),
    });
  }

  await withQuestions(person.id);

  // One line on one of the person's items, so "the lines go" is a claim about a row that
  // was there. Nothing in this file's fixtures writes one otherwise.
  const [anItem] = await testDb
    .select({ id: profileItem.id })
    .from(profileItem)
    .where(eq(profileItem.userId, person.id));
  if (anItem === undefined) throw new Error(`the fixture for ${email} wrote no profile item`);
  await testDb
    .insert(itemLine)
    .values({ id: randomUUID(), itemId: anItem.id, text: "A line of their profile.", position: 0 });

  // Two questions answered in the person's own words, each keeping one profile concern:
  // since `SL3` no concern is written on an item nobody asked about (D14), and since `SL7`
  // an answer is the profile assistant's action (D9).
  const profile = await profileOf(person.id);
  const [asked, second] = profile.questions;
  if (asked === undefined || second === undefined) {
    throw new Error(`the run for ${email} asked fewer than two questions`);
  }
  for (const { id } of [asked, second]) {
    const answered = await app.request("/api/conversations/profile/actions/answer_question", {
      method: "POST",
      headers: { cookie: person.cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId: id, words: "I wrote it, nobody else did" }),
    });
    if (answered.status !== 200) throw new Error(`the answer for ${email} was ${answered.status}`);
  }

  /**
   * One more document, handed over after the profile was there, and it is the one object
   * this file watches.
   *
   * A reading consumes what it reads since `ID309`, so the object the erasure has to take
   * is a document nobody has read yet — which is also the state a person is in when they
   * delete their account mid-intake. This one is that document: nothing cites it, and its
   * key is the key the cases ask the storage for.
   */
  const unread = (await (
    await app.request("/api/intake/documents", {
      method: "POST",
      headers: { cookie: person.cookie },
      body: uploadOfFixture(theSet.diploma.filename),
    })
  ).json()) as { id: string };

  return { ...person, keys: [keyFor(person.id, unread.id)] };
};

/** The library's own route, driven as the web app's client drives it. */
const deleteAccount = (cookie: string): Promise<Response> =>
  auth.handler(
    new Request(`${appUrl}/api/auth/delete-user`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: appUrl },
      body: JSON.stringify({}),
    }),
  );

/** What is left of one person, asked of the intake's own tables and of the storage. */
const whatIsLeftOf = async (person: { id: string; keys: ObjectKey[] }) => ({
  documents: (await testDb.select().from(document).where(eq(document.userId, person.id))).length,
  items: (await testDb.select().from(profileItem).where(eq(profileItem.userId, person.id))).length,
  questions: (await testDb.select().from(question).where(eq(question.userId, person.id))).length,
  rules: (await testDb.select().from(profileConcern).where(eq(profileConcern.userId, person.id)))
    .length,
  objects: (await Promise.all(person.keys.map((key) => storage.get(key)))).filter(
    (object) => object !== null,
  ).length,
});

/** The lines, which hang off items rather than off the person. */
const traceOf = async (person: { id: string }) => {
  const items = await testDb.select().from(profileItem).where(eq(profileItem.userId, person.id));
  const ids = new Set(items.map((item) => item.id));
  const lines = (await testDb.select().from(itemLine)).filter((line) => ids.has(line.itemId));
  return { lines: lines.length };
};

describe("the erasure, through the library's own delete-user (criterion 9)", () => {
  it("takes the documents, their objects, the items, the lines, the rules and the questions", async () => {
    const person = await aPersonWithAProfile("erased@example.com");

    const before = await whatIsLeftOf(person);
    const trace = await traceOf(person);
    expect(before.documents).toBe(3);
    expect(before.objects).toBe(1);
    expect(before.items).toBeGreaterThan(0);
    expect(before.questions).toBeGreaterThan(0);
    expect(before.rules).toBe(2);
    expect(trace.lines).toBeGreaterThan(0);

    const answer = await deleteAccount(person.cookie);
    expect(answer.status).toBe(200);

    expect(await whatIsLeftOf(person)).toEqual({
      documents: 0,
      items: 0,
      questions: 0,
      rules: 0,
      objects: 0,
    });
    expect(await traceOf(person)).toEqual({ lines: 0 });
    expect(await profileOf(person.id)).toMatchObject({ questions: [], experience: [] });
  }, 120_000);

  it("asks the storage for the upload it still holds, by its own key, and it is not there", async () => {
    const person = await aPersonWithAProfile("erased-objects@example.com");
    expect(person.keys).toHaveLength(1);
    for (const key of person.keys) expect(await storage.get(key)).not.toBeNull();

    await deleteAccount(person.cookie);

    for (const key of person.keys) expect(await storage.get(key)).toBeNull();
  }, 120_000);

  it("erases a person who uploaded nothing, cleanly (the empty branch)", async () => {
    const person = await signedIn("erased-empty@example.com");

    const answer = await deleteAccount(person.cookie);

    expect(answer.status).toBe(200);
    expect(await whatIsLeftOf({ ...person, keys: [] })).toEqual({
      documents: 0,
      items: 0,
      questions: 0,
      rules: 0,
      objects: 0,
    });
  }, 60_000);
});

describe("the person beside them (criterion 10)", () => {
  it("leaves the other's documents, objects, items, rules and questions alone, and their session still answers", async () => {
    const staying = await aPersonWithAProfile("staying@example.com");
    const going = await aPersonWithAProfile("going@example.com");
    const before = await whatIsLeftOf(staying);
    const trace = await traceOf(staying);

    await deleteAccount(going.cookie);

    expect(await whatIsLeftOf(staying)).toEqual(before);
    expect(await traceOf(staying)).toEqual(trace);
    // Read back through their own session, never by counting rows: an erasure that took
    // both people's items would still leave a count above zero for one of them.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: staying.cookie }),
    });
    expect(session?.user.email).toBe("staying@example.com");
    expect((await profileOf(staying.id)).questions.length).toBeGreaterThan(0);
  }, 180_000);
});

describe("a failure anywhere in it (criterion 11)", () => {
  it("throws, leaves the user row and everything of theirs alone, and a second attempt erases what is left", async () => {
    const person = await aPersonWithAProfile("refused@example.com");
    const real = storage;
    let refusing = true;
    objects.storage = {
      put: (key: ObjectKey, object) => real.put(key, object),
      get: (key: ObjectKey) => real.get(key),
      delete: async (key: ObjectKey) => {
        if (refusing) throw new Error(`the object will not delete: ${key}`);
        await real.delete(key);
      },
    } satisfies Storage;

    const refused = await deleteAccount(person.cookie);

    expect(refused.status).not.toBe(200);
    // The one outcome D8 cannot tolerate the other way round: the user survives.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: person.cookie }),
    });
    expect(session?.user.email).toBe("refused@example.com");
    const left = await whatIsLeftOf(person);
    expect(left.documents).toBe(3);
    expect(left.objects).toBe(1);
    expect(left.items).toBeGreaterThan(0);

    refusing = false;
    const second = await deleteAccount(person.cookie);

    expect(second.status).toBe(200);
    expect(await whatIsLeftOf(person)).toEqual({
      documents: 0,
      items: 0,
      questions: 0,
      rules: 0,
      objects: 0,
    });
  }, 180_000);
});
