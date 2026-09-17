import { randomUUID } from "node:crypto";
import {
  document,
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemKind,
  itemLine,
  itemProject,
  profileItem,
  provenance,
  type QuestionKind,
  question,
  questionKind,
  questionOption,
} from "@app/db";
import { type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { asc, eq, inArray } from "drizzle-orm";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { z } from "zod";
import { type About, askFor } from "../lib/ai";
import type { Assistant, ConversationsAgent } from "../lib/assistant";
import { existing } from "../lib/conversation";
import { db } from "../lib/db";
import { slugOf } from "../lib/documents";
import { asking, refused } from "../lib/session";
import { type ObjectKey, storage } from "../lib/storage";
import { createEnvelope } from "../lib/stream";
import { composed, textOf } from "../lib/text";

const factory = createFactory();

/**
 * What the person's profile conversation is told once a reading has written the profile
 * (D34): one sentence, so the agent reads the profile again before relying on what it read
 * earlier (D33). One constant, beside the reading.
 */
export const profileUpdatedNotice =
  "Your profile was updated from your documents. Read it again before relying on it.";

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
 * **What changed is pushed into the profile conversation** (D34): once the profile is
 * written and committed, the conversation with the `profile` definition, when the person
 * has one, is notified through the agent the composition root hands over (rule 7). With no
 * conversation yet, or a reading that failed, nothing is written there.
 *
 * It is plain functions inside the streaming route the foundation already built for long
 * work, persisting per unit. Step Functions is not adopted (`D8`).
 */
export const readDocuments = (agent: ConversationsAgent, profile: Assistant) =>
  factory.createHandlers(async (c) => {
    const person = await asking(c);
    if (person === null) return refused(c);

    /**
     * Every document this person handed over, and not only the new ones (`ID157`, the
     * person 2026-09-12).
     *
     * The call is over the documents composed into one, and the answer is the whole
     * profile — so a run over the new document alone would write a profile made of that
     * document alone, and the one before it would be gone. What decides whether a run
     * happens at all is still whether anything is unread; what it reads, once it happens,
     * is everything.
     */
    const everything = await db
      .select()
      .from(document)
      .where(eq(document.userId, person.id))
      .orderBy(asc(document.createdAt), asc(document.id));

    // Nothing new, nothing to do: a person pressing Read twice over the same documents
    // makes one call, not two (`SL2`'s criterion 11).
    const waiting = everything.some((row) => row.status !== "read") ? everything : [];

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
       * Every file of this run, read as text and kept for the one call that follows
       * (`ID157`, `ID158`).
       *
       * They are held for the length of the run and not written to a table of their own,
       * because the register has none: a fact becomes a row when the reading places it,
       * as `profile_item` with its `provenance`. A run with nothing new to read makes no
       * call at all, which is what keeps a second run free of them (`SL2`'s criterion 11).
       */
      const read: { name: string; id: string; text: string }[] = [];

      /** Whether this run's reading was written whole and committed, which is what is notified. */
      let profileWritten = false;

      try {
        for (const row of waiting) {
          await db.update(document).set({ status: "reading" }).where(eq(document.id, row.id));
          await envelope.send({ kind: "document", id: row.id, status: "reading", reason: null });

          // The typed address is the one source with nothing to read: nothing is fetched,
          // which is what the spec's non-goals say and what the screen's lead promises
          // (F5). So it is read the moment the run reaches it, with no call and no kind.
          if (row.source !== "file" || row.storageKey === null) {
            await db
              .update(document)
              .set({ status: "read", readAt: new Date() })
              .where(eq(document.id, row.id));
            await envelope.send({ kind: "document", id: row.id, status: "read", reason: null });
            continue;
          }

          /**
           * A document that cannot become text fails alone, and only here.
           *
           * This is the one failure that belongs to a single document, because it happens
           * before the call: a format nothing can read as characters, or bytes that are
           * not there any more. Everything past this point is one call over all of them,
           * so it succeeds or fails for all of them (`ID157`).
           */
          try {
            // The key was written by the upload, which is the only writer of it (`ID115`).
            const object = await storage.get(row.storageKey as ObjectKey);
            if (object === null) throw new Error(`${row.filename} is not in storage any more`);
            read.push({
              name: slugOf(row.filename),
              id: row.id,
              text: await textOf({
                filename: row.filename,
                mediaType: object.mediaType,
                bytes: object.bytes,
              }),
            });
          } catch {
            // Why it failed is not carried out to the person in the reader's words: what
            // they are told is which of their documents could not be read, and that the
            // rest were.
            // A run of one has no others, and a sentence that says it has reads like a
            // fault in the product rather than in the document (SL8's finding).
            const reason =
              waiting.length === 1
                ? `${row.filename} could not be read.`
                : `${row.filename} could not be read. The others were.`;
            await db
              .update(document)
              .set({ status: "failed", failureReason: reason })
              .where(eq(document.id, row.id));
            await envelope.send({ kind: "document", id: row.id, status: "failed", reason });
          }
        }

        /**
         * The reading: one composed document, one call (`ID157`, the person 2026-09-12).
         *
         * Every document this run could read is joined into a single document, each part
         * under the name the profile's sources cite, and one call answers with the whole
         * profile and the questions it leaves open. There is no classification step and no
         * merge: nothing branches on what kind a document is (`ID158`), and nothing needs
         * reconciling when the model saw every document at once.
         *
         * What the shape of the pipeline used to guarantee, the answer now has to carry:
         * a fact cites the part it came from, and `writeProfile` refuses a citation naming
         * a document this run did not read. A malformed answer is a failed reading and
         * nothing else — nothing is written, and the rows stay unread so the next run
         * takes them again.
         */
        if (read.length > 0) {
          const names = read.map((part) => part.name);
          try {
            const answered = await retriedOnce(() =>
              askFor(
                readingAll(composed(read.map(({ name, text }) => ({ name, text })))),
                theReadingOf(names),
                reading,
              ),
            );
            await writeProfile(
              person.id,
              { items: answered.items },
              new Map(read.map((part) => [part.name, part.id])),
            );
            await db
              .update(document)
              .set({ status: "read", failureReason: null, readAt: new Date() })
              .where(
                inArray(
                  document.id,
                  read.map((part) => part.id),
                ),
              );
            for (const part of read) {
              await envelope.send({ kind: "document", id: part.id, status: "read", reason: null });
            }
            await writeQuestions(person.id, { candidates: answered.candidates });
            profileWritten = true;
          } catch {
            // One call over all of them, so one failure over all of them. The rows stay
            // where they were — not `read`, so the next run takes them again — and the
            // person's previous profile is untouched, because `writeProfile` writes the
            // whole profile or none of it.
            const reason =
              "Your documents could not be read this time. Nothing was lost: try again.";
            await db
              .update(document)
              .set({ status: "failed", failureReason: reason })
              .where(
                inArray(
                  document.id,
                  read.map((part) => part.id),
                ),
              );
            for (const part of read) {
              await envelope.send({ kind: "document", id: part.id, status: "failed", reason });
            }
          }
        }

        if (profileWritten) {
          // The profile is written whatever happens here: a notice that cannot be written
          // is logged, and the reading still ends as done.
          try {
            const conversation = await existing(person, profile.name, null);
            if (conversation !== undefined) await agent.notify(conversation, profileUpdatedNotice);
          } catch (thrown) {
            console.error("the profile conversation could not be told of the reading", thrown);
          }
        }

        await envelope.send({ kind: "run", status: "done" });
      } finally {
        envelope.close();
      }
    });
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
        concern: z.string().nullish(),
      }),
    )
    .min(2)
    .max(4),
});

const proposal = z.object({ candidates: z.array(candidate) });

/**
 * What the reading is asked: one composed document, one answer (`ID157`, `ID158`).
 *
 * The whole of the pipeline is this prompt. It replaces four — a classification per
 * document, an extraction per document, a merge over the extractions and a pass for the
 * questions — because a model that is shown every document at once has nothing to
 * reconcile and no reason to be told first what kind of thing it is looking at.
 *
 * The one thing the shape of the old pipeline guaranteed and this prompt has to ask for
 * is **attribution**: a reading per document made a source true by construction, and a
 * reading over all of them makes it a claim. So the answer names, for every fact, the
 * part it came from and the words that part used, and `writeProfile` refuses a citation
 * naming a part this run did not read.
 */
const readingAll = (document: string): BaseMessage[] => [
  new SystemMessage(
    "You read everything a job seeker has handed over, given as one document whose parts are marked <<<DOCUMENT name>>> … <<<END>>>, and you write their profile and the questions it leaves open. Answer with JSON alone, as an object with items and candidates. Each item has kind, one of summary, identity, experience, project, education, publication, language, group, entry; title; the optional subtitle, start_text and end_text as the documents wrote them; the block for its kind (experience, project, education, entry); lines; children; and sources. A source is the name of the part the fact came from and what that part said, word for word in that part's own language. A fact stated by several parts carries one source per part and no third wording of your own. Never state a figure no part states: no duration, no seniority, no total. Each candidate is a question the documents themselves cannot answer, with kind, one of scope (a fact says what was done but not what the person's part was), conflict (two parts state the same thing differently) or provenance (a term appears in a way that leaves its standing unclear); item, the exact title of the item it is about; where, the item's place said the way the profile says it; lead, the question itself in one or two sentences; and options, two to four answers, each with label, hint and the concern that answer writes, the last of which is the person's own words and carries no concern. Never ask about a fact the parts agree on and state plainly, never ask about a date a part states, and never ask what a person can be assumed to know about their own job.",
  ),
  new HumanMessage(document),
];

/** What a reading is about: the run's documents, by name, in the run's order. */
const theReadingOf = (names: string[]): About => ({
  feature: "intake",
  step: "read",
  input: names.join("+"),
});

/**
 * What the reading answers: the profile, and the questions it leaves open, together.
 *
 * One shape for one call. A malformed half is a malformed answer — there is no partly
 * written profile with unasked questions beside it, because neither is written until
 * both have been read.
 */
const reading = z.object({
  items: z.array(mergedItem).min(1),
  candidates: z.array(candidate),
});

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
 * and not the reader's: a reader that proposes such a question is refused here.
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
          // The last row is always the person's own words, so it carries no concern of its
          // own whatever the reader proposed for it.
          concern: position === proposed.options.length - 1 ? null : (option.concern ?? null),
        });
      }
    }
  });
};
