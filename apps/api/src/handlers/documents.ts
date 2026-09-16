import { randomUUID } from "node:crypto";
import { type Document, document } from "@app/db";
import { and, asc, eq } from "drizzle-orm";
import { createFactory } from "hono/factory";
import { env } from "../env";
import { db } from "../lib/db";
import { isDuplicate } from "../lib/db/duplicate";
import { hashOf, kindOf } from "../lib/documents";
import { asking, refused } from "../lib/session";
import { keyFor, storage } from "../lib/storage";

/**
 * The intake's document handlers: what each route proves, written where it is done, as
 * `handlers/health.ts` already writes it.
 *
 * What they hide: the hashing, the size limit, the key's composition, the ownership
 * check and the detection of a kind. What they accept: the database and `storage` as
 * their dependencies, and neither is constructed here.
 *
 * **Every route filters by the session's user.** There is no handler here that can read
 * or delete a row it does not own, and an id that belongs to somebody else is a 404 and
 * never a 403, because a 403 confirms the row exists.
 */

const factory = createFactory();

/** The limit, said the way a person says it rather than in bytes. */
const asMegabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * What a row looks like on the wire: what the screen draws, and nothing the screen has
 * no business with. The storage key and the content hash stay here — the key is the
 * server's only handle on a person's bytes, and a browser that never sees one cannot
 * ask for another person's.
 */
const asAnswer = (row: Document) => ({
  id: row.id,
  filename: row.filename,
  mediaType: row.mediaType,
  source: row.source,
  address: row.address,
  detectedKind: row.detectedKind,
  detectedLanguage: row.detectedLanguage,
  status: row.status,
  failureReason: row.failureReason,
  readAt: row.readAt === null ? null : row.readAt.toISOString(),
});

/** What the web app is given for a document. Declared once, inferred everywhere above. */
export type DocumentAnswer = ReturnType<typeof asAnswer>;

/** The constraint that says this person already has these bytes (`S2`'s schema). */
const sameBytesTwice = "document_user_content_hash";

/**
 * One document, or one typed address, handed over.
 *
 * The order is the whole of it: the row is written first, the key is composed from that
 * row's own id, and only then is the object put. A failed put therefore leaves a row
 * whose object is absent — which `get` answering `null` is exactly for — and never an
 * object that no row names and nothing will ever delete.
 *
 * The duplicate is the database's answer, not a read followed by a write: the unique
 * constraint on `(user_id, content_hash)` is what two requests arriving together cannot
 * slip between. The size is refused before any of it, with the limit and the file named.
 */
export const addDocument = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return refused(c);

  const body = await c.req.parseBody();
  const file = body["file"];
  const address = typeof body["address"] === "string" ? body["address"].trim() : "";

  if (!(file instanceof File)) {
    if (address === "") {
      return c.json({ error: "hand over a document or type a LinkedIn address" }, 400);
    }
    // The one source with no bytes, no key and no hash (D3, US2). Its kind is not
    // detected and never will be: nothing is fetched, so nothing reads it (F5).
    const [row] = await db
      .insert(document)
      .values({
        id: randomUUID(),
        userId: person.id,
        filename: address,
        mediaType: "text/uri-list",
        source: "linkedin_address",
        address,
        status: "waiting",
      })
      .returning();
    if (row === undefined) return c.json({ error: "the address could not be kept" }, 500);
    return c.json(asAnswer(row), 201);
  }

  if (file.size > env.UPLOAD_LIMIT_BYTES) {
    return c.json(
      {
        error: `${file.name} is larger than ${asMegabytes(env.UPLOAD_LIMIT_BYTES)}, which is the most I can take.`,
      },
      413,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = file.type === "" ? "application/octet-stream" : file.type;
  const contentHash = hashOf(bytes);
  const id = randomUUID();

  let row: Document | undefined;
  try {
    [row] = await db
      .insert(document)
      .values({
        id,
        userId: person.id,
        filename: file.name,
        mediaType,
        source: "file",
        detectedKind: kindOf(file.name, mediaType),
        storageKey: keyFor(person.id, id),
        contentHash,
        status: "waiting",
      })
      .returning();
  } catch (cause) {
    if (!isDuplicate(cause, sameBytesTwice)) throw cause;
    const [already] = await db
      .select()
      .from(document)
      .where(and(eq(document.userId, person.id), eq(document.contentHash, contentHash)));
    return c.json(
      { error: `${already?.filename ?? file.name} is already here.`, documentId: already?.id },
      409,
    );
  }
  if (row === undefined) return c.json({ error: "the document could not be kept" }, 500);

  await storage.put(keyFor(person.id, id), { bytes, mediaType });
  return c.json(asAnswer(row), 201);
});

/**
 * This person's documents, oldest first, as they stand.
 *
 * **This route is the resume.** Progress is rows, not client state: a person who closed
 * the tab mid-reading and came back is answered here, with waiting, reading, read and
 * failed exactly as the run left them, and no frame is replayed from anybody's memory
 * (`US3`, criterion 11).
 */
export const listDocuments = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return refused(c);

  const rows = await db
    .select()
    .from(document)
    .where(eq(document.userId, person.id))
    .orderBy(asc(document.createdAt), asc(document.id));

  return c.json(rows.map(asAnswer), 200);
});

/**
 * One document taken back, before the reading or after it, with its object.
 *
 * The row goes first and the object after, which is the same order the upload wrote in
 * and for the same reason: what must never happen is an object that no row names.
 */
export const removeDocument = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return refused(c);

  const [row] = await db
    .delete(document)
    .where(and(eq(document.id, c.req.param("id") ?? ""), eq(document.userId, person.id)))
    .returning();

  // Not found rather than forbidden: a 403 would confirm that somebody else's row is
  // there, which is a fact this person has no right to.
  if (row === undefined) return c.json({ error: "no such document" }, 404);

  if (row.storageKey !== null) {
    await storage.delete(keyFor(person.id, row.id));
  }
  return c.json({ removed: row.id }, 200);
});
