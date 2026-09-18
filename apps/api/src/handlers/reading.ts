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
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { z } from "zod";
import { type About, askFor } from "../lib/ai";
import type { Assistant, ConversationsAgent } from "../lib/assistant";
import { existing } from "../lib/conversation";
import { db } from "../lib/db";
import { slugOf } from "../lib/documents";
import { type ItemRead, itemsOf } from "../lib/profile-edit";
import { asking, refused } from "../lib/session";
import { type ObjectKey, storage } from "../lib/storage";
import { createEnvelope } from "../lib/stream";
import { composed, textOf } from "../lib/text";

const factory = createFactory();

/**
 * How many titles a notice names before it counts the rest (`ID311`). A summary is read
 * in one breath; a profile read from a career's worth of documents is not.
 */
const atMostTenTitles = 10;

/** What the notice ends with, whatever a reading found: read it again (D33, D34). */
const readItAgain = "Read it again before relying on it.";

/**
 * What the person's profile conversation is told once a reading has written the profile
 * (D34, `ID311`): the documents it read, what it added and what it added to, and the one
 * instruction that matters — read the profile again before relying on what was read
 * earlier (D33).
 *
 * **The summary is built from what was written, not asked for.** A second call to say
 * what the first call did would be a sentence nothing stands behind; these are the titles
 * of the rows the transaction inserted, and the names of the documents that produced them.
 */
const noticeOf = (documents: string[], added: string[], addedTo: string[]): string => {
  const names = documents.join(", ");
  if (added.length === 0 && addedTo.length === 0) {
    return `Your documents were read: ${names}. Nothing new was found in them. ${readItAgain}`;
  }
  const shown = added.slice(0, atMostTenTitles);
  const shownTo = addedTo.slice(0, Math.max(0, atMostTenTitles - shown.length));
  const rest = added.length + addedTo.length - shown.length - shownTo.length;
  const said = [
    shown.length === 0 ? "" : `added ${shown.join(", ")}`,
    shownTo.length === 0 ? "" : `added to ${shownTo.join(", ")}`,
    rest === 0 ? "" : `and ${rest} more`,
  ].filter((part) => part !== "");
  return `Your profile was updated from your documents: ${names}. It ${said.join("; ")}. ${readItAgain}`;
};

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
     * The documents this run reads: the ones not read yet, and nothing else (`ID309`).
     *
     * A reading used to take every document the person had ever handed over, because the
     * answer was the whole profile and a run over the new document alone would have
     * written a profile made of that document alone. It adds now, so "only the unread" is
     * what the data already says rather than a filter of its own — and a document is an
     * input that is consumed: read once, its facts placed, its file disposed of.
     *
     * Nothing unread is nothing to do, so a person pressing Read twice over the same
     * documents makes one call and not two (`SL2`'s criterion 11).
     */
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
       * Every file of this run, read as text and kept for the one call that follows
       * (`ID157`, `ID158`).
       *
       * They are held for the length of the run and not written to a table of their own,
       * because the register has none: a fact becomes a row when the reading places it,
       * as `profile_item` with its `provenance`. A run with nothing new to read makes no
       * call at all, which is what keeps a second run free of them (`SL2`'s criterion 11).
       */
      const read: { name: string; id: string; key: ObjectKey; text: string }[] = [];

      /**
       * What the profile conversation is told once the reading is committed, or nothing
       * when this run wrote no profile at all (`ID311`, D34).
       */
      let notice: string | null = null;

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
            const key = row.storageKey as ObjectKey;
            const object = await storage.get(key);
            if (object === null) throw new Error(`${row.filename} is not in storage any more`);
            read.push({
              name: slugOf(row.filename),
              id: row.id,
              key,
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
         * under the name the profile's sources cite, and one call answers it. There is no
         * classification step and no merge: nothing branches on what kind a document is
         * (`ID158`), and nothing needs reconciling when the model saw every document at
         * once.
         *
         * **Which call it is, is the profile's answer and not a setting** (`ID308`). With
         * no profile, the prompt that creates one, unchanged. With a profile, the prompt
         * that is shown it and answers with what is new — because a reading adds now, and
         * what the person and the agent built together has to survive it (`D38`).
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
            const text = composed(read.map(({ name, text }) => ({ name, text })));
            // The profile as `read_profile` answers it, which is what the second prompt is
            // shown (`ID308`): a read in a transaction of its own, because that is the one
            // shape `itemsOf` takes and this read writes nothing.
            const standing = await db.transaction((tx) => itemsOf(tx, person.id));
            const answered =
              standing.length === 0
                ? await retriedOnce(() => askFor(readingAll(text), theReadingOf(names), reading))
                : await retriedOnce(() =>
                    askFor(readingMore(standing, text), theReadingOf(names), additions),
                  );
            const written = await writeProfile(
              person.id,
              answered,
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
            // The profile is committed and the rows say `read`, so the inputs can go
            // (`ID309`). The row stays — it is the name a fact cites — and only the file
            // and the key that reaches it are disposed of.
            await disposeOf(read);
            notice = noticeOf(
              read.map((part) => part.name),
              written.added,
              written.addedTo,
            );
          } catch {
            // One call over all of them, so one failure over all of them. The rows stay
            // where they were — not `read`, so the next run takes them again — the files
            // stay where they were, and the profile is untouched, because `writeProfile`
            // writes all of a reading or none of it.
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

        if (notice !== null) {
          // The profile is written whatever happens here: a notice that cannot be written
          // is logged, and the reading still ends as done.
          try {
            const conversation = await existing(person, profile.name, null);
            if (conversation !== undefined) await agent.notify(conversation, notice);
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

/**
 * The inputs consumed, once the profile that cites them is committed (`ID309`, D38).
 *
 * A document is read, its facts are placed, and its file goes. What stays is the row —
 * its name and when it was read — because that is what a fact cites and what makes the
 * same bytes handed over twice still a duplicate.
 *
 * **A file that will not go is logged and nothing more.** The profile is written; a run
 * that failed here and said so would tell the person their documents could not be read,
 * which is not what happened. The key is left on the row when the delete fails, so the
 * object is still named by something and the account's deletion takes it (`lib/auth`).
 */
const disposeOf = async (read: { id: string; name: string; key: ObjectKey }[]): Promise<void> => {
  for (const part of read) {
    try {
      await storage.delete(part.key);
      await db.update(document).set({ storageKey: null }).where(eq(document.id, part.id));
    } catch (thrown) {
      console.error(`the file of ${part.name} could not be disposed of after the reading`, thrown);
    }
  }
};

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

const mergedLine = z.object({ text: z.string().min(1), sources: z.array(quoted).min(1) });

/**
 * What a reading may add to an item the profile already has (`ID308`): new lines, and new
 * items under it. There is no field that changes, moves or removes anything, and that
 * absence is the whole of `D38` — what the person and the agent built together survives a
 * reading because the shape of an answer cannot touch it.
 */
type Extension = { itemId: string; lines?: MergedLine[]; children?: MergedItem[] };

type MergedLine = z.infer<typeof mergedLine>;

const extension = z.object({
  itemId: z.string().min(1),
  lines: z.array(mergedLine).default([]),
  children: z.array(mergedItem).default([]),
});

/** What a reading wrote, by title: the notice that follows is built from this and nothing else. */
type Written = { added: string[]; addedTo: string[] };

/**
 * The reading written, whole or not at all — and only ever added (`ID308`, `D38`).
 *
 * Two things are resolved **before** the transaction opens, and each of them is a refusal:
 * every source, to a document row of this run, so an answer citing a document nobody
 * handed over fails as a step rather than as half a profile; and every `extends`, to an
 * item of this person, so an answer naming somebody else's item — or none at all — writes
 * nothing.
 *
 * Inside, nothing is deleted and nothing is updated. New items take positions after the
 * last item, new lines after the item's last line, new children after its last child, so
 * what the profile already holds keeps its ids, its order and its concerns.
 */
const writeProfile = async (
  userId: string,
  answered: { items: MergedItem[]; extends?: Extension[] },
  documents: Map<string, string>,
): Promise<Written> => {
  const additions = answered.extends ?? [];
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
  for (const item of answered.items) everySource(item);
  for (const addition of additions) {
    for (const line of addition.lines ?? []) {
      for (const source of line.sources) documentFor(source.document);
    }
    for (const child of addition.children ?? []) everySource(child);
  }

  /** The person's items as they stand: what an `extends` may name, and where new rows go. */
  const standing = await db
    .select({
      id: profileItem.id,
      kind: profileItem.kind,
      title: profileItem.title,
      parentId: profileItem.parentId,
      position: profileItem.position,
    })
    .from(profileItem)
    .where(eq(profileItem.userId, userId));
  const itemOf = new Map(standing.map((item) => [item.id, item]));
  for (const addition of additions) {
    const item = itemOf.get(addition.itemId);
    if (item === undefined) {
      throw new Error(`the reading extended ${addition.itemId}, which is not this person's item`);
    }
  }

  /** Where the next root item goes: after the last of them, and never among them. */
  const afterTheLast =
    standing
      .filter((item) => item.parentId === null)
      .reduce((last, item) => Math.max(last, item.position), -1) + 1;

  await db.transaction(async (tx) => {
    /** The position after the last row of a set, read inside the transaction that adds to it. */
    const after = async (positions: Promise<{ position: number }[]>): Promise<number> =>
      (await positions).reduce((last, row) => Math.max(last, row.position), -1) + 1;

    const writeLines = async (itemId: string, lines: MergedLine[], from: number) => {
      for (const [at, line] of lines.entries()) {
        const lineId = randomUUID();
        await tx
          .insert(itemLine)
          .values({ id: lineId, itemId, text: line.text, position: from + at });
        for (const source of line.sources) {
          await tx.insert(provenance).values({
            id: randomUUID(),
            documentId: documentFor(source.document),
            lineId,
            said: source.said,
          });
        }
      }
    };

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
      await writeLines(id, item.lines ?? [], 0);
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

    for (const [at, item] of answered.items.entries()) {
      await write(item, afterTheLast + at, null);
    }

    for (const addition of additions) {
      const item = itemOf.get(addition.itemId);
      if (item === undefined) continue;
      await writeLines(
        addition.itemId,
        addition.lines ?? [],
        await after(
          tx
            .select({ position: itemLine.position })
            .from(itemLine)
            .where(eq(itemLine.itemId, addition.itemId)),
        ),
      );
      // The same flatness the write above holds, held where an entry is added to (D17).
      const children = item.kind === "entry" ? [] : (addition.children ?? []);
      const from = await after(
        tx
          .select({ position: profileItem.position })
          .from(profileItem)
          .where(eq(profileItem.parentId, addition.itemId)),
      );
      for (const [at, child] of children.entries()) await write(child, from + at, addition.itemId);
    }
  });

  return {
    added: answered.items.map((item) => item.title),
    addedTo: additions
      .filter((addition) => (addition.lines ?? []).length + (addition.children ?? []).length > 0)
      .map((addition) => itemOf.get(addition.itemId)?.title ?? addition.itemId),
  };
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
 * What a reading of a person who already has a profile is asked (`ID308`).
 *
 * It is a second prompt and not a second paragraph of the first, because the two are
 * asked for different things. The first writes a profile from nothing; this one is shown
 * the profile as it stands and the documents nobody has read yet, and answers with what is
 * new in them. The sentences the two share are written out twice on purpose: the first
 * prompt is what every shipped recording was recorded against, and a shared fragment would
 * make an edit here an edit there.
 *
 * **The answer can only add**, and nothing in its shape can do anything else: a new item,
 * or new lines and new children on an item named by its id. What "the same item" is stays
 * the model's call; this is what bounds what that call can cost.
 */
const readingMore = (profile: ItemRead[], document: string): BaseMessage[] => [
  new SystemMessage(
    "You read the new documents a job seeker has handed over, given as one document whose parts are marked <<<DOCUMENT name>>> … <<<END>>>, against the profile they already have, and you answer with what is new in them and nothing else. The profile comes first, as JSON, marked <<<PROFILE>>> … <<<END>>>: each item with its id, its kind, its title, its dates, its lines with their ids, the items under it, and the concerns the person has settled about it. Answer with JSON alone, as an object with items, extends and candidates. items are facts the profile does not have at all, each with kind, one of summary, identity, experience, project, education, publication, language, group, entry; title; the optional subtitle, start_text and end_text as the documents wrote them; the block for its kind (experience, project, education, entry); lines; children; and sources. extends are additions to items the profile already has, each with itemId, that item's id exactly as the profile gives it, and lines, new lines for it, and children, new items under it; every line and every child carries its own sources. A document that restates something the profile already has gives nothing at all: a new achievement on a post the profile has is a new line on that post, and a new skill is a new child of the group that holds the others. You can only add. Nothing you answer moves, rewrites or removes anything the profile holds, and there is no field for it: what the person settled stays as it is. A source is the name of the part the fact came from and what that part said, word for word in that part's own language. A fact stated by several parts carries one source per part and no third wording of your own. Never state a figure no part states: no duration, no seniority, no total. Each candidate is a question the documents themselves cannot answer, with kind, one of scope (a fact says what was done but not what the person's part was), conflict (two parts state the same thing differently) or provenance (a term appears in a way that leaves its standing unclear); item, the exact title of the item it is about; where, the item's place said the way the profile says it; lead, the question itself in one or two sentences; and options, two to four answers, each with label, hint and the concern that answer writes, the last of which is the person's own words and carries no concern. Never ask about a fact the parts agree on and state plainly, never ask about a date a part states, and never ask what a person can be assumed to know about their own job.",
  ),
  new HumanMessage(`<<<PROFILE>>>\n${JSON.stringify(profile, null, 2)}\n<<<END>>>\n\n${document}`),
];

/**
 * What the second reading answers: what is new, and nothing else (`ID308`).
 *
 * Every part of it may be empty, and that is a successful reading: documents that say
 * nothing the profile does not already hold are still documents that were read.
 */
const additions = z.object({
  items: z.array(mergedItem).default([]),
  extends: z.array(extension).default([]),
  candidates: z.array(candidate).default([]),
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
 *
 * **It only ever inserts, and a second reading takes the positions after the last**
 * (`ID310`). The questions a person is already holding — waiting, answered or put aside —
 * are untouched: this step has no flow of its own, and nothing here restricts a candidate
 * to what the same reading added.
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

  const standing = await db
    .select({ position: question.position })
    .from(question)
    .where(eq(question.userId, userId));
  const afterTheLast = standing.reduce((last, row) => Math.max(last, row.position), -1) + 1;

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
        position: afterTheLast + at,
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
