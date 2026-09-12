import { createHash, randomUUID } from "node:crypto";
import {
  document,
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemKind,
  itemLine,
  itemProject,
  type ProfileItem,
  profileItem,
  provenance,
  type QuestionKind,
  type QuestionState,
  question,
  questionKind,
  questionOption,
  type RuleKind,
  type RuleSource,
  rule,
} from "@app/db";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
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

    /**
     * What each document of this run said, kept for the merge that follows it.
     *
     * They are held for the length of the run and not written to a table of their own,
     * because the register has none: a fact becomes a row when the merge places it, as
     * `profile_item` with its `provenance`. A run that reads nothing new merges nothing,
     * which is what keeps a second run free of calls (`SL2`'s criterion 11).
     */
    const readings: { slug: string; id: string; facts: unknown }[] = [];

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
          // Read alone, and read whole: what the document is, then what it states. A
          // document whose extraction cannot be read has not been read, so the two are
          // one step and the row moves to `read` only when both have landed.
          const stated = await askFor(
            extractCaseFor(row.filename),
            extractingFrom(row.filename, read.kind, read.language),
            extraction,
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
          readings.push({ slug: slugOf(row.filename), id: row.id, facts: stated.facts });
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
      /**
       * The merge, once, over what this run read (`S3.2`).
       *
       * It is one call over several readings, never one call over several documents:
       * what makes two CVs of one month yield one experience with two sources is that
       * two separate extractions were reconciled, and a call over concatenated
       * documents would pass every count and lose the provenance.
       *
       * A malformed answer is a failed step and nothing else. Nothing is written, the
       * documents stay read, and the person's previous profile is untouched — because
       * the shape is refused before `writeProfile` opens its transaction, and that
       * transaction writes the whole profile or none of it.
       */
      if (readings.length > 0) {
        const slugs = readings.map((reading) => reading.slug);
        let merged: z.infer<typeof merge> | null = null;
        try {
          merged = await askFor(
            mergeCaseFor(slugs),
            merging(readings.map(({ slug, facts }) => ({ slug, facts }))),
            merge,
          );
          await writeProfile(
            person.id,
            merged,
            new Map(readings.map((reading) => [reading.slug, reading.id])),
          );
        } catch {
          // Said to nobody on the wire: the run is over either way and the profile route
          // is what the screen asks next. What a failed merge leaves is documents that
          // are read and a profile that is not there yet.
          merged = null;
        }

        /**
         * The fourth step, over the profile the merge just wrote (`S4.1`).
         *
         * **It retries once and no more** (spec, *Failure modes*). On a second failure
         * the run stops here: nothing is written, the rows already read are kept, and
         * the person's profile is exactly what the merge produced. Nothing is charged,
         * because the mock is what answers in every environment this slice runs in.
         *
         * A malformed answer is a failed step too, refused by the shape below before a
         * row is written, so there is never a partly written set of questions.
         */
        const written = merged;
        if (written !== null) {
          try {
            const asked = await retriedOnce(() =>
              askFor(questionsCaseFor(slugs), askingWhatOnlyYouKnow(written), proposal),
            );
            await writeQuestions(person.id, asked);
          } catch {
            // The same silence as the merge's, and for the same reason: the run is over,
            // what was read is kept, and the profile route is what the screen asks next.
          }
        }
      }

      await envelope.send({ kind: "run", status: "done" });
    } finally {
      envelope.close();
    }
  });
});

/**
 * What a document's own slug is: its filename without the extension (`F1`, settled here
 * for extraction as `caseFor` settled it for classification). Stable across runs, and
 * matchable to a real file by eye in the fixture directory.
 */
const slugOf = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? filename : filename.slice(0, dot);
};

/**
 * One fact a single document states, with the sentence that document states it in.
 *
 * Extraction is **per document**, and that is the whole point of it: what makes the
 * merge provable is that two separate readings were reconciled. One call over two
 * concatenated CVs would pass every count and lose the provenance.
 */
const extraction = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(itemKind.enumValues),
        title: z.string().min(1),
        said: z.string().min(1),
        lines: z.array(z.object({ text: z.string().min(1), said: z.string().min(1) })).default([]),
      }),
    )
    .min(1),
});

/** One item the merge produced, and what hangs under it. Recursive, so a project nests. */
type Quoted = { document: string; said: string };

/** What a shape may leave out. The repository's TypeScript has `exactOptionalPropertyTypes`. */
type Maybe<T> = T | null | undefined;

type MergedItem = {
  kind: ItemKind;
  title: string;
  subtitle?: Maybe<string>;
  start_text?: Maybe<string>;
  end_text?: Maybe<string>;
  experience?: Maybe<{
    organisation: string;
    organisation_note?: Maybe<string>;
    location?: Maybe<string>;
    arrangement?: Maybe<string>;
  }>;
  project?: Maybe<{ description: string; dates_text?: Maybe<string> }>;
  education?: Maybe<{
    institution: string;
    location?: Maybe<string>;
    credential?: Maybe<string>;
    note?: Maybe<string>;
  }>;
  entry?: Maybe<{ label: string; qualifier?: Maybe<string> }>;
  lines?: { text: string; sources: Quoted[] }[];
  children?: MergedItem[];
  sources: Quoted[];
};

const quoted = z.object({ document: z.string().min(1), said: z.string().min(1) });

/**
 * What the merge must answer with, validated at the boundary before a row is written.
 *
 * A malformed answer is a failed step and never a partly written profile (spec,
 * *Failure modes*): `askFor` parses, this shape refuses, and the writer below never
 * runs. `sources` is required on every item, because an item nothing said is exactly
 * the thing this product promises not to produce.
 */
const mergedItem: z.ZodType<MergedItem> = z.lazy(() =>
  z.object({
    kind: z.enum(itemKind.enumValues),
    title: z.string().min(1),
    subtitle: z.string().nullish(),
    start_text: z.string().nullish(),
    end_text: z.string().nullish(),
    experience: z
      .object({
        organisation: z.string().min(1),
        organisation_note: z.string().nullish(),
        location: z.string().nullish(),
        arrangement: z.string().nullish(),
      })
      .nullish(),
    project: z
      .object({ description: z.string().min(1), dates_text: z.string().nullish() })
      .nullish(),
    education: z
      .object({
        institution: z.string().min(1),
        location: z.string().nullish(),
        credential: z.string().nullish(),
        note: z.string().nullish(),
      })
      .nullish(),
    entry: z.object({ label: z.string().min(1), qualifier: z.string().nullish() }).nullish(),
    lines: z
      .array(z.object({ text: z.string().min(1), sources: z.array(quoted).min(1) }))
      .default([]),
    children: z.array(mergedItem).default([]),
    sources: z.array(quoted).min(1),
  }),
);

const merge = z.object({ items: z.array(mergedItem).min(1) });

/** What a reader is asked of one document. The mock reads none of it; a provider would. */
const extractingFrom = (
  filename: string,
  kind: string | null,
  language: string | null,
): Message[] => [
  {
    role: "system",
    content:
      "You read one document a job seeker handed over and list what it states. Answer with JSON alone: facts, an array of objects with kind, one of summary, identity, experience, project, education, publication, language, group, entry; title; said, the sentence this document states the fact in, copied word for word and never translated or rewritten; and lines, an array of objects with text and said, for the bullets of a post or a project. Invent nothing. A figure no sentence of the document contains is not a fact.",
  },
  {
    role: "user",
    content: `The document is ${filename}, read as a ${kind ?? "document"} written in ${language ?? "an unstated language"}.`,
  },
];

/**
 * What the merge is asked. Each document's reading arrives under its own slug, so the
 * model reconciles readings rather than concatenated documents, and every source it
 * cites names one of them.
 */
const merging = (readings: { slug: string; facts: unknown }[]): Message[] => [
  {
    role: "system",
    content:
      "You merge the readings of several documents into one profile. Answer with JSON alone: items, each with kind, title, the optional subtitle, start_text and end_text as the documents wrote them, the block for its kind (experience, project, education, entry), lines, children, and sources. A source is the document's slug and what that document said, word for word in that document's own language. When two documents state the same fact differently, keep both sources against the one item and write no third wording of your own. Never state a figure no document states: no duration, no seniority, no total.",
  },
  { role: "user", content: JSON.stringify({ readings }) },
];

/** The case a merge is recorded under: the run's documents, by slug, in the run's order. */
const mergeCaseFor = (slugs: string[]): CaseName => `intake.merge:${slugs.join("+")}`;

/** The case one document's extraction is recorded under (`ID111`, `D20`). */
const extractCaseFor = (filename: string): CaseName => `intake.extract:${slugOf(filename)}`;

/**
 * The merged profile, written whole or not at all.
 *
 * Every source is resolved to a document row **before** the transaction opens, so a
 * merge that cites a document this run never read fails as a step rather than as half a
 * profile. Inside, the person's previous items go and the new ones land: a profile is
 * what this run's documents say, and a stale item nothing cites any more is not a fact.
 */
const writeProfile = async (
  userId: string,
  merged: z.infer<typeof merge>,
  documents: Map<string, string>,
): Promise<void> => {
  const documentFor = (slug: string): string => {
    const id = documents.get(slug);
    if (id === undefined) throw new Error(`the merge cited ${slug}, which this run did not read`);
    return id;
  };
  const everySource = (item: MergedItem): void => {
    for (const source of item.sources) documentFor(source.document);
    for (const line of item.lines ?? []) {
      for (const source of line.sources) documentFor(source.document);
    }
    for (const child of item.children ?? []) everySource(child);
  };
  for (const item of merged.items) everySource(item);

  await db.transaction(async (tx) => {
    await tx.delete(profileItem).where(eq(profileItem.userId, userId));

    const write = async (item: MergedItem, position: number, parentId: string | null) => {
      const id = randomUUID();
      await tx.insert(profileItem).values({
        id,
        userId,
        kind: item.kind,
        parentId,
        title: item.title,
        subtitle: item.subtitle ?? null,
        startText: item.start_text ?? null,
        endText: item.end_text ?? null,
        position,
      });
      if (item.experience != null) {
        await tx.insert(itemExperience).values({
          itemId: id,
          organisation: item.experience.organisation,
          organisationNote: item.experience.organisation_note ?? null,
          location: item.experience.location ?? null,
          arrangement: item.experience.arrangement ?? null,
        });
      }
      if (item.project != null) {
        await tx.insert(itemProject).values({
          itemId: id,
          description: item.project.description,
          datesText: item.project.dates_text ?? null,
        });
      }
      if (item.education != null) {
        await tx.insert(itemEducation).values({
          itemId: id,
          institution: item.education.institution,
          location: item.education.location ?? null,
          credential: item.education.credential ?? null,
          note: item.education.note ?? null,
        });
      }
      if (item.entry != null) {
        await tx
          .insert(itemEntry)
          .values({ itemId: id, label: item.entry.label, qualifier: item.entry.qualifier ?? null });
      }
      for (const [at, line] of (item.lines ?? []).entries()) {
        const lineId = randomUUID();
        await tx.insert(itemLine).values({ id: lineId, itemId: id, text: line.text, position: at });
        for (const source of line.sources) {
          await tx.insert(provenance).values({
            id: randomUUID(),
            documentId: documentFor(source.document),
            lineId,
            said: source.said,
          });
        }
      }
      for (const source of item.sources) {
        await tx.insert(provenance).values({
          id: randomUUID(),
          documentId: documentFor(source.document),
          itemId: id,
          said: source.said,
        });
      }
      // A group's entries are entries and an entry has nothing under it: that is what
      // makes a group flat by construction rather than by the screen's restraint (D17).
      const children = item.kind === "entry" ? [] : (item.children ?? []);
      for (const [at, child] of children.entries()) await write(child, at, id);
    };

    for (const [at, item] of merged.items.entries()) await write(item, at, null);
  });
};

/**
 * The fourth step: what the documents could not say (`S4.1`, the spec's *The questions*).
 *
 * **The cap lives here and nowhere else** (`D19`, `ID122`, `F1`). It is applied when the
 * run writes the questions, not when a screen reads them: the first five are written
 * `asked = true` and the rest `asked = false` against their items. A route that wrote
 * eleven and showed five would leave six questions that look asked and are not. The
 * number is a value in one place so that tuning it on the first real intakes is one
 * edit; it is not configuration, because that would be a setting nobody owns.
 */
const atMostFive = 5;

/**
 * What the reader may propose, and what it must answer with.
 *
 * **The kind is a string here and an enum in the database**, and the difference is the
 * whole of criterion 1. A candidate of a fourth kind is a proposal this step declines —
 * dropped, never stored — and not a malformed answer that fails the step; what makes a
 * fourth kind impossible is the column, which PostgreSQL refuses a value outside.
 *
 * Four answers at most, the design language's cap for an exclusive choice and the spec's
 * cap on a question. Two at least, because one answer is not a question.
 */
const candidate = z.object({
  kind: z.string().min(1),
  item: z.string().min(1),
  where: z.string().min(1),
  lead: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        hint: z.string().min(1),
        rule: z.string().nullish(),
      }),
    )
    .min(2)
    .max(4),
});

const proposal = z.object({ candidates: z.array(candidate) });

/** The case the fourth step is recorded under: the run's documents, by slug (`ID111`). */
const questionsCaseFor = (slugs: string[]): CaseName => `intake.questions:${slugs.join("+")}`;

/**
 * One more attempt, and one only (spec, *Failure modes*). The second failure is the
 * caller's to decide about; here it is simply thrown on.
 */
const retriedOnce = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch {
    return call();
  }
};

/** What the reader is asked of the profile it has just written. */
const askingWhatOnlyYouKnow = (merged: z.infer<typeof merge>): Message[] => [
  {
    role: "system",
    content:
      "You have read a job seeker's documents and written their profile. Name only the things the documents themselves cannot answer. Answer with JSON alone: candidates, each with kind, one of scope (a fact says what was done but not what the person's part was), conflict (two documents state the same thing differently) or provenance (a term appears once, in a way that leaves its standing unclear); item, the exact title of the profile item it is about; where, the item's place said the way the profile says it; lead, the question itself, in one or two sentences; and options, two to four answers, each with label, hint and the rule that answer writes, the last of which is the person's own words and carries no rule. Never ask about a fact the documents agree on and state plainly, never ask about a date a document states, and never ask what a person can be assumed to know about their own job.",
  },
  { role: "user", content: JSON.stringify(merged) },
];

/**
 * The questions written, whole or not at all.
 *
 * Three things are refused before anything is written, and each one is a claim:
 *
 * **A kind that is not one of the three is dropped.** The spec says "three kinds, and
 * nothing else", and a fourth is a proposal this step declines rather than an answer it
 * refuses.
 *
 * **A candidate whose item is not in the profile is dropped.** A question never points
 * at nothing, and a later correction that removes an item takes its question with it
 * through the foreign key's `on delete cascade`.
 *
 * **A candidate about a fact the documents agree on and state plainly is dropped**
 * (`US5`, criterion 3). Two or more documents that stated a fact in the very same words
 * have agreed about it and stated it plainly, so there is nothing there only the person
 * knows, and asking would be quizzing them about their own CV. This is the run's rule
 * and not the fixture's: a reader that proposes such a question is refused here.
 */
const writeQuestions = async (userId: string, asked: z.infer<typeof proposal>): Promise<void> => {
  const items = await db
    .select()
    .from(profileItem)
    .where(eq(profileItem.userId, userId))
    .orderBy(asc(profileItem.position), asc(profileItem.id));

  /** The item a title names. The first of a repeated title wins, as the profile orders. */
  const idOf = new Map<string, string>();
  for (const item of items) if (!idOf.has(item.title)) idOf.set(item.title, item.id);

  const quotes = await db
    .select({
      itemId: provenance.itemId,
      said: provenance.said,
      documentId: provenance.documentId,
    })
    .from(provenance)
    .innerJoin(document, eq(provenance.documentId, document.id))
    .where(eq(document.userId, userId));

  const wordingsOf = new Map<string, Set<string>>();
  const documentsOf = new Map<string, Set<string>>();
  for (const quote of quotes) {
    if (quote.itemId === null) continue;
    wordingsOf.set(quote.itemId, (wordingsOf.get(quote.itemId) ?? new Set()).add(quote.said));
    documentsOf.set(
      quote.itemId,
      (documentsOf.get(quote.itemId) ?? new Set()).add(quote.documentId),
    );
  }

  const agreedPlainly = (itemId: string): boolean =>
    (documentsOf.get(itemId)?.size ?? 0) >= 2 && (wordingsOf.get(itemId)?.size ?? 0) === 1;

  const kinds = new Set<string>(questionKind.enumValues);
  const keep = asked.candidates.flatMap((proposed) => {
    if (!kinds.has(proposed.kind)) return [];
    const itemId = idOf.get(proposed.item);
    if (itemId === undefined) return [];
    if (agreedPlainly(itemId)) return [];
    return [{ ...proposed, kind: proposed.kind as QuestionKind, itemId }];
  });
  if (keep.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [at, proposed] of keep.entries()) {
      const id = randomUUID();
      await tx.insert(question).values({
        id,
        userId,
        itemId: proposed.itemId,
        kind: proposed.kind,
        asked: at < atMostFive,
        where: proposed.where,
        lead: proposed.lead,
        state: "waiting",
        position: at,
      });
      for (const [position, option] of proposed.options.entries()) {
        await tx.insert(questionOption).values({
          id: randomUUID(),
          questionId: id,
          position,
          label: option.label,
          hint: option.hint,
          // The last row is always the person's own words, so it carries no rule of its
          // own whatever the reader proposed for it.
          rule: position === proposed.options.length - 1 ? null : (option.rule ?? null),
        });
      }
    }
  });
};

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

/**
 * One rule on the wire. `supersededBy` is carried, not hidden, because what `ID121`
 * exists to keep is the history: a screen shows the current rule, and the earlier words
 * are still readable beside it.
 */
export type RuleAnswer = {
  id: string;
  text: string;
  kind: RuleKind;
  source: RuleSource;
  createdAt: string;
  supersededBy: string | null;
};

/** One question on the wire, with the item it is about and the rows it offers. */
export type QuestionAnswer = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: QuestionKind;
  where: string;
  lead: string;
  state: QuestionState;
  options: { id: string; label: string; hint: string; rule: string | null }[];
};

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
  /** What the person said about this item, newest first. Nothing is ever removed. */
  rules: RuleAnswer[];
  /** The one rule nothing has superseded: what the builder reads before writing. */
  rule: RuleAnswer | null;
  /** The question this intake asked about it, whatever state it is now in. */
  question: QuestionAnswer | null;
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
  /** The questions this intake asked, in the order they are asked. At most five. */
  questions: QuestionAnswer[];
  /** How many more were written against their items and deferred to the builder (`D19`). */
  notAsked: number;
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
  questions: [],
  notAsked: 0,
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
  const [experiences, projects, educations, entries, lines, quotes, questions, options, rules] =
    await Promise.all([
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
      // The questions in the order they are asked, and the rules newest first, so the
      // current one is the head of the list as well as the row nothing has superseded.
      db
        .select()
        .from(question)
        .where(eq(question.userId, userId))
        .orderBy(asc(question.position), asc(question.id)),
      db
        .select({
          id: questionOption.id,
          questionId: questionOption.questionId,
          label: questionOption.label,
          hint: questionOption.hint,
          rule: questionOption.rule,
        })
        .from(questionOption)
        .innerJoin(question, eq(questionOption.questionId, question.id))
        .where(eq(question.userId, userId))
        .orderBy(asc(questionOption.position), asc(questionOption.id)),
      db
        .select()
        .from(rule)
        .where(eq(rule.userId, userId))
        .orderBy(desc(rule.createdAt), desc(rule.id)),
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

  /** What each question offers, and which item each question and each rule is about. */
  const titleOf = new Map(items.map((item) => [item.id, item.title]));
  const optionsOf = new Map<string, QuestionAnswer["options"]>();
  for (const option of options) {
    optionsOf.set(option.questionId, [
      ...(optionsOf.get(option.questionId) ?? []),
      { id: option.id, label: option.label, hint: option.hint, rule: option.rule },
    ]);
  }
  const asQuestion = (row: (typeof questions)[number]): QuestionAnswer => ({
    id: row.id,
    itemId: row.itemId,
    itemTitle: titleOf.get(row.itemId) ?? "",
    kind: row.kind,
    where: row.where,
    lead: row.lead,
    state: row.state,
    options: optionsOf.get(row.id) ?? [],
  });
  const questionOf = new Map<string, QuestionAnswer>();
  for (const row of questions) {
    if (row.asked && !questionOf.has(row.itemId)) questionOf.set(row.itemId, asQuestion(row));
  }

  const rulesOf = new Map<string, RuleAnswer[]>();
  for (const row of rules) {
    rulesOf.set(row.itemId, [
      ...(rulesOf.get(row.itemId) ?? []),
      {
        id: row.id,
        text: row.text,
        kind: row.kind,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
        supersededBy: row.supersededBy,
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
      rules: rulesOf.get(item.id) ?? [],
      // The item's current rule is the one row nothing has superseded, which is a fact
      // about the rows rather than the newest of them (`ID121`).
      rule: (rulesOf.get(item.id) ?? []).find((each) => each.supersededBy === null) ?? null,
      question: questionOf.get(item.id) ?? null,
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
    questions: questions.filter((row) => row.asked).map(asQuestion),
    notAsked: questions.filter((row) => !row.asked).length,
  };
};

/**
 * What a person says when a question is open: a row, their own words, both, or neither
 * yet. `skip` is the fourth thing they can do and it is an answer of its own — the
 * question is kept, not deleted, and offered again the first time a CV needs it (`US7`).
 */
const answering = z.object({
  optionId: z.string().min(1).optional(),
  words: z.string().optional(),
  skip: z.boolean().optional(),
});

/** `Kubernetes: shipping to a cluster run by others` — the item, then what was said. */
const ruleAbout = (title: string, words: string): string => `${title}: ${words}`;

/**
 * A rule kept, and the one it supersedes.
 *
 * **Inserted, never updated.** Answering again writes a new row and marks the old one
 * superseded, so the history of what the person said survives being changed (`ID121`).
 * An `update` here would pass every test that reads only the current rule and quietly
 * destroy the one thing this table exists to keep.
 */
const keepAsRule = async (kept: {
  userId: string;
  itemId: string;
  kind: RuleKind;
  text: string;
  source: RuleSource;
  questionId: string | null;
}): Promise<RuleAnswer> => {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const [written] = await tx
      .insert(rule)
      .values({
        id,
        userId: kept.userId,
        itemId: kept.itemId,
        kind: kept.kind,
        text: kept.text,
        source: kept.source,
        questionId: kept.questionId,
      })
      .returning();
    await tx
      .update(rule)
      .set({ supersededBy: id })
      .where(
        and(
          eq(rule.itemId, kept.itemId),
          eq(rule.userId, kept.userId),
          isNull(rule.supersededBy),
          ne(rule.id, id),
        ),
      );
    if (written === undefined) throw new Error("the rule could not be kept");
    return {
      id: written.id,
      text: written.text,
      kind: written.kind,
      source: written.source,
      createdAt: written.createdAt.toISOString(),
      supersededBy: null,
    };
  });
};

/**
 * One question answered, or put off (`S4.3`, `S4.4`, `US6`, `US7`).
 *
 * A question that is not this person's is a `404` and never a `403`, as every route here
 * answers for a row that is not yours: a `403` would confirm that somebody else's
 * question exists. A question whose item a later correction removed is gone with it
 * through the item's `on delete cascade`, so it is the same `404` — a question never
 * points at nothing.
 */
export const answerQuestion = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return c.json({ error: "sign in first" }, 401);

  const said = answering.safeParse(await c.req.json().catch(() => ({})));
  if (!said.success) return c.json({ error: "say which row, or say it in your own words" }, 400);

  const [row] = await db
    .select()
    .from(question)
    .where(and(eq(question.id, c.req.param("id") ?? ""), eq(question.userId, person.id)));
  if (row === undefined) return c.json({ error: "no such question" }, 404);

  if (said.data.skip === true) {
    await db.update(question).set({ state: "skipped" }).where(eq(question.id, row.id));
    return c.json({ skipped: row.id }, 200);
  }

  const words = (said.data.words ?? "").trim();
  const [option] =
    said.data.optionId === undefined
      ? []
      : await db
          .select()
          .from(questionOption)
          .where(
            and(eq(questionOption.id, said.data.optionId), eq(questionOption.questionId, row.id)),
          );
  if (said.data.optionId !== undefined && option === undefined) {
    return c.json({ error: "no such answer" }, 404);
  }

  const [item] = await db.select().from(profileItem).where(eq(profileItem.id, row.itemId));
  if (item === undefined) return c.json({ error: "no such question" }, 404);

  // The picked row's own rule, and the person's words beside it when they typed as well.
  // The last row carries no rule, so picking it is the same thing as saying it yourself.
  const picked = option?.rule ?? null;
  if (picked === null && words === "") {
    return c.json({ error: "pick a row, or say it in your own words" }, 400);
  }
  const text =
    picked === null ? ruleAbout(item.title, words) : words === "" ? picked : `${picked} — ${words}`;

  const kept = await keepAsRule({
    userId: person.id,
    itemId: row.itemId,
    // A scope question asks what the person's part was; a conflict and a provenance
    // question both settle what may never be claimed (the spec's *The rules*).
    kind: row.kind === "scope" ? "scope" : "constraint",
    text,
    source: picked === null ? "own words" : "answer",
    questionId: row.id,
  });

  await db
    .update(question)
    .set({ state: "answered", answeredAt: new Date() })
    .where(eq(question.id, row.id));

  return c.json({ rule: kept }, 200);
});

/**
 * What the person said about an item nobody asked them about.
 *
 * It is the answer's own-words path with no question attached, which is why it is
 * mounted and proved here; **its screen is `SL5`'s** (the tool the person opens
 * themselves, which proposes nothing).
 */
export const writeItemRule = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return c.json({ error: "sign in first" }, 401);

  const said = z
    .object({ words: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!said.success) return c.json({ error: "say it in your own words" }, 400);

  const [item] = await db
    .select()
    .from(profileItem)
    .where(and(eq(profileItem.id, c.req.param("id") ?? ""), eq(profileItem.userId, person.id)));
  if (item === undefined) return c.json({ error: "no such item" }, 404);

  const kept = await keepAsRule({
    userId: person.id,
    itemId: item.id,
    kind: "scope",
    text: ruleAbout(item.title, said.data.words.trim()),
    source: "own words",
    questionId: null,
  });
  return c.json({ rule: kept }, 200);
});

/** This person's whole profile, or an empty one. Never anybody else's, and never a 404. */
export const readProfile = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return c.json({ error: "sign in first" }, 401);
  return c.json(await profileOf(person.id), 200);
});
