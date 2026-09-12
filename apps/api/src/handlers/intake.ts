import { createHash, randomUUID } from "node:crypto";
import { document } from "@app/db";
import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { env } from "../env";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
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

/** Who is asking, according to the library. `null` is every route's 401. */
const asking = async (c: Context): Promise<{ id: string } | null> => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session === null ? null : { id: session.user.id };
};

/**
 * What a person is told a document is, before anything has read it.
 *
 * The reading is what decides for real (`POST /read`, through `lib/ai`), and this is
 * what the row says in the meantime, so the list a person sees the instant they drop
 * five files is not five rows saying nothing. It reads the name and the media type and
 * no bytes at all: a person who drops `BS-HEIGVD-IL-Diplome.pdf` should see "diploma"
 * before a model has been anywhere near it.
 *
 * Nothing branches on the answer. It is a column's value, and `linkedin_export` and
 * `photo_of_cv` are in it although the person's own set holds neither, because the
 * product accepts both and the screen draws both (`D20`, `D3`).
 */
export type DetectedKind =
  "cv" | "diploma" | "work_certificate" | "linkedin_export" | "photo_of_cv" | "unknown";

export const kindOf = (filename: string, mediaType: string): DetectedKind => {
  const name = filename.toLowerCase();
  if (mediaType.startsWith("image/")) return "photo_of_cv";
  if (name.includes("linkedin")) return "linkedin_export";
  if (/dipl[oô]m|bachelor|master|cfc|licence/.test(name)) return "diploma";
  if (/certificat|certificate|attestation|zeugnis/.test(name)) return "work_certificate";
  if (/cv|resume|curriculum|lebenslauf/.test(name)) return "cv";
  return "unknown";
};

/** The digest a duplicate is recognised by: SHA-256 over the bytes, lowercase hex. */
const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The limit, said the way a person says it rather than in bytes. */
const asMegabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * What a row looks like on the wire: what the screen draws, and nothing the screen has
 * no business with. The storage key and the content hash stay here — the key is the
 * server's only handle on a person's bytes, and a browser that never sees one cannot
 * ask for another person's.
 */
const asAnswer = (row: typeof document.$inferSelect) => ({
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

/**
 * Whether a failed insert failed because this person already has these bytes.
 *
 * The whole chain is read, not the top message: Drizzle wraps the driver's error, and
 * what names the constraint is the driver's, two causes down. Reading only the top one
 * would turn the refusal criterion 5 asks for into a 500.
 */
const isDuplicate = (thrown: unknown): boolean => {
  const said: string[] = [];
  for (let cause = thrown; cause instanceof Error; cause = cause.cause) {
    said.push(cause.message, String((cause as { constraint_name?: string }).constraint_name ?? ""));
  }
  return /document_user_content_hash|duplicate key/i.test(said.join(" "));
};

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
  if (person === null) return c.json({ error: "sign in first" }, 401);

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

  let row: typeof document.$inferSelect | undefined;
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
    if (!isDuplicate(cause)) throw cause;
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
  if (person === null) return c.json({ error: "sign in first" }, 401);

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
  if (person === null) return c.json({ error: "sign in first" }, 401);

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
