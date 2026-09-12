import { createHash, randomUUID } from "node:crypto";
import {
  document,
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemLine,
  itemProject,
  type ProfileItem,
  profileItem,
  provenance,
} from "@app/db";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { z } from "zod";
import { env } from "../env";
import { askFor, type CaseName, type Message } from "../lib/ai";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { keyFor, storage } from "../lib/storage";
import { createEnvelope } from "../lib/stream";

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

/**
 * What a reader is asked for, and what it must answer with. The kinds are the column's
 * own; the language is what the document is written in, which is a separate question
 * from what the person reads (`Q14`, still open).
 */
const classification = z.object({
  kind: z.enum(["cv", "diploma", "work_certificate", "linkedin_export", "photo_of_cv", "unknown"]),
  language: z.string().min(2),
  confidence: z.number(),
  why: z.string(),
});

/**
 * The case a document's classification is recorded under: the file's own name, without
 * its extension, under the step `intake.classify` (`F3`, `D20`). A case therefore stands
 * for a real file and can be matched to it by eye in the fixture directory, which a
 * content hash could not. The hash keeps its one job, which is the duplicate.
 */
const caseFor = (filename: string): CaseName => {
  const dot = filename.lastIndexOf(".");
  return `intake.classify:${dot <= 0 ? filename : filename.slice(0, dot)}`;
};

/** What the reader is told. The mock reads none of it; a provider would read all of it. */
const askingAbout = (filename: string, mediaType: string): Message[] => [
  {
    role: "system",
    content:
      "You classify one document a job seeker has handed over. Answer with JSON alone: kind, one of cv, diploma, work_certificate, linkedin_export, photo_of_cv, unknown; language, as an ISO 639-1 code; confidence, between 0 and 1; why, one or two sentences naming what in the document decided it.",
  },
  { role: "user", content: `The document is named ${filename} and is a ${mediaType}.` },
];

/**
 * The reading run (ID119, `D8`).
 *
 * Four things make this route what the slice asks for, and each of them is a decision:
 *
 * **A document is read alone.** One failing document does not fail the run — it is
 * marked with a sentence naming it, and the others go on — because a person who handed
 * over five CVs should not lose four to one file nobody can read.
 *
 * **The row is written before the frame is sent**, never after. A frame in a reader's
 * hands that the database does not yet agree with is a run a reload contradicts, and
 * that contradiction is exactly what criterion 11 is.
 *
 * **Resume is a read of the rows and nothing else.** There is no run id, nothing in the
 * browser's storage, and no replay of frames from memory: a person who closed the tab
 * asks `GET /documents` and is answered with where the run got to.
 *
 * **A document already read is not read again.** A second run costs nothing and asks
 * nothing, which is what makes pressing the button twice harmless.
 *
 * It is plain functions inside the streaming route the foundation already built for long
 * work, persisting per unit. Step Functions is not adopted (`D8`).
 */
export const readDocuments = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return c.json({ error: "sign in first" }, 401);

  const waiting = await db
    .select()
    .from(document)
    .where(and(eq(document.userId, person.id), ne(document.status, "read")))
    .orderBy(asc(document.createdAt), asc(document.id));

  // The raw stream helper rather than the server-sent-event one, and the headers that
  // helper would set, set here: the envelope already writes `id:` and `data:` lines.
  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("x-accel-buffering", "no");

  return stream(c, async (response) => {
    const envelope = createEnvelope(async (chunk) => {
      await response.write(chunk);
    });
    response.onAbort(() => {
      envelope.close();
    });

    try {
      for (const row of waiting) {
        await db.update(document).set({ status: "reading" }).where(eq(document.id, row.id));
        await envelope.send({ kind: "document", id: row.id, status: "reading", reason: null });

        // The typed address is the one source with nothing to read: nothing is fetched,
        // which is what the spec's non-goals say and what the screen's lead promises
        // (F5). So it is read the moment the run reaches it, with no call and no kind.
        if (row.source !== "file") {
          await db
            .update(document)
            .set({ status: "read", readAt: new Date() })
            .where(eq(document.id, row.id));
          await envelope.send({ kind: "document", id: row.id, status: "read", reason: null });
          continue;
        }

        try {
          const read = await askFor(
            caseFor(row.filename),
            askingAbout(row.filename, row.mediaType),
            classification,
          );
          await db
            .update(document)
            .set({
              status: "read",
              detectedKind: read.kind,
              detectedLanguage: read.language,
              failureReason: null,
              readAt: new Date(),
            })
            .where(eq(document.id, row.id));
          await envelope.send({ kind: "document", id: row.id, status: "read", reason: null });
        } catch {
          // Why it failed is not carried out to the person: an AI failure names the case
          // and the endpoint, which says nothing they can act on. What they are told is
          // which of their documents could not be read, and that the rest were.
          const reason = `${row.filename} could not be read. The others were.`;
          await db
            .update(document)
            .set({ status: "failed", failureReason: reason })
            .where(eq(document.id, row.id));
          await envelope.send({ kind: "document", id: row.id, status: "failed", reason });
        }
      }
      await envelope.send({ kind: "run", status: "done" });
    } finally {
      envelope.close();
    }
  });
});

/**
 * The profile a person reads back (`ID118`'s `GET /profile`, criteria 2, 6, 8, 9).
 *
 * **One payload, deliberately not paged** (`F4`). Exhaustiveness is the screen's whole
 * contract, so a page size would be the first fold, and a real profile is a few hundred
 * rows. What comes back is the rows as the tables hold them, reshaped by nothing: the
 * spine's columns, the per-kind block for the item's own kind, its lines, its children,
 * and what each document said about it, verbatim.
 *
 * **Every count here is a count of rows.** `documents` beside an item is
 * `count(distinct document_id)` over that item's provenance, which is what makes
 * "4 documents" a fact about the database rather than a number somebody stored (`F3`).
 * Nothing is derived from a date and no arithmetic is done anywhere below.
 *
 * Filtered by the session's user like every route here, and a person with nothing read
 * is answered an empty profile rather than a 404: having no profile yet is not the same
 * thing as there being no such address (spec, *Failure modes*).
 */

/** What one document said about one fact, and which document said it. */
type Source = { document: string; said: string };

/** One item on the wire: the spine, the per-kind block, its lines and what hangs under it. */
export type ProfileItemAnswer = {
  id: string;
  kind: ItemKind;
  title: string;
  subtitle: string | null;
  startText: string | null;
  endText: string | null;
  documents: number;
  experience: {
    organisation: string;
    organisationNote: string | null;
    location: string | null;
    arrangement: string | null;
  } | null;
  project: { description: string; datesText: string | null } | null;
  education: {
    institution: string;
    location: string | null;
    credential: string | null;
    note: string | null;
  } | null;
  entry: { label: string; qualifier: string | null } | null;
  lines: { id: string; text: string; documents: number; sources: Source[] }[];
  children: ProfileItemAnswer[];
  sources: Source[];
};

/** The whole profile, in the panels the sheet draws, so the sheet composes nothing. */
export type ProfileAnswer = {
  name: string | null;
  documents: number;
  readOn: string | null;
  summary: ProfileItemAnswer | null;
  identity: ProfileItemAnswer | null;
  experience: ProfileItemAnswer[];
  projects: ProfileItemAnswer[];
  groups: ProfileItemAnswer[];
  education: ProfileItemAnswer[];
};

/** An empty profile: a person who has read nothing yet, and not an error. */
const noProfileYet: ProfileAnswer = {
  name: null,
  documents: 0,
  readOn: null,
  summary: null,
  identity: null,
  experience: [],
  projects: [],
  groups: [],
  education: [],
};

/** The whole of one person's profile, assembled from the rows. */
export const profileOf = async (userId: string): Promise<ProfileAnswer> => {
  const items = await db
    .select()
    .from(profileItem)
    .where(eq(profileItem.userId, userId))
    .orderBy(asc(profileItem.position), asc(profileItem.id));
  if (items.length === 0) return noProfileYet;

  const ids = items.map((item) => item.id);
  const [experiences, projects, educations, entries, lines, quotes] = await Promise.all([
    db.select().from(itemExperience).where(inArray(itemExperience.itemId, ids)),
    db.select().from(itemProject).where(inArray(itemProject.itemId, ids)),
    db.select().from(itemEducation).where(inArray(itemEducation.itemId, ids)),
    db.select().from(itemEntry).where(inArray(itemEntry.itemId, ids)),
    db
      .select()
      .from(itemLine)
      .where(inArray(itemLine.itemId, ids))
      .orderBy(asc(itemLine.position), asc(itemLine.id)),
    // The documents in the order the person handed them over, so two documents that
    // said the same thing are quoted in a stable order and never in the order a hash
    // happened to produce.
    db
      .select({
        itemId: provenance.itemId,
        lineId: provenance.lineId,
        said: provenance.said,
        filename: document.filename,
        readAt: document.readAt,
        documentId: document.id,
      })
      .from(provenance)
      .innerJoin(document, eq(provenance.documentId, document.id))
      .where(eq(document.userId, userId))
      .orderBy(asc(document.createdAt), asc(document.id), asc(provenance.id)),
  ]);

  const by = <T extends { itemId: string }>(rows: T[]): Map<string, T> =>
    new Map(rows.map((row) => [row.itemId, row]));
  const experienceOf = by(experiences);
  const projectOf = by(projects);
  const educationOf = by(educations);
  const entryOf = by(entries);

  /** What each item and each line was told, by which document, and by how many. */
  const saidOf = { item: new Map<string, Source[]>(), line: new Map<string, Source[]>() };
  const countOf = { item: new Map<string, Set<string>>(), line: new Map<string, Set<string>>() };
  const documentsUsed = new Set<string>();
  let readOn: Date | null = null;
  for (const quote of quotes) {
    const against = quote.itemId === null ? "line" : "item";
    const key = quote.itemId ?? quote.lineId ?? "";
    saidOf[against].set(key, [
      ...(saidOf[against].get(key) ?? []),
      { document: quote.filename, said: quote.said },
    ]);
    countOf[against].set(key, (countOf[against].get(key) ?? new Set()).add(quote.documentId));
    documentsUsed.add(quote.documentId);
    if (quote.readAt !== null && (readOn === null || quote.readAt > readOn)) readOn = quote.readAt;
  }

  const linesOf = new Map<string, ProfileItemAnswer["lines"]>();
  for (const line of lines) {
    linesOf.set(line.itemId, [
      ...(linesOf.get(line.itemId) ?? []),
      {
        id: line.id,
        text: line.text,
        documents: countOf.line.get(line.id)?.size ?? 0,
        sources: saidOf.line.get(line.id) ?? [],
      },
    ]);
  }

  const asAnswer = (item: ProfileItem): ProfileItemAnswer => {
    const experience = experienceOf.get(item.id);
    const project = projectOf.get(item.id);
    const education = educationOf.get(item.id);
    const entry = entryOf.get(item.id);
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      startText: item.startText,
      endText: item.endText,
      documents: countOf.item.get(item.id)?.size ?? 0,
      experience:
        experience === undefined
          ? null
          : {
              organisation: experience.organisation,
              organisationNote: experience.organisationNote,
              location: experience.location,
              arrangement: experience.arrangement,
            },
      project:
        project === undefined
          ? null
          : { description: project.description, datesText: project.datesText },
      education:
        education === undefined
          ? null
          : {
              institution: education.institution,
              location: education.location,
              credential: education.credential,
              note: education.note,
            },
      entry: entry === undefined ? null : { label: entry.label, qualifier: entry.qualifier },
      lines: linesOf.get(item.id) ?? [],
      children: items.filter((each) => each.parentId === item.id).map(asAnswer),
      sources: saidOf.item.get(item.id) ?? [],
    };
  };

  const roots = items.filter((item) => item.parentId === null).map(asAnswer);
  const of = (...kinds: ItemKind[]) => roots.filter((item) => kinds.includes(item.kind));

  return {
    name: of("identity")[0]?.title ?? null,
    documents: documentsUsed.size,
    readOn: readOn === null ? null : readOn.toISOString(),
    summary: of("summary")[0] ?? null,
    identity: of("identity")[0] ?? null,
    experience: of("experience"),
    projects: of("project"),
    groups: of("group"),
    education: of("education", "publication", "language"),
  };
};

/** This person's whole profile, or an empty one. Never anybody else's, and never a 404. */
export const readProfile = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return c.json({ error: "sign in first" }, 401);
  return c.json(await profileOf(person.id), 200);
});
