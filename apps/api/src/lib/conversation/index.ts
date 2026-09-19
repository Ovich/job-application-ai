import { randomUUID } from "node:crypto";
import type * as schema from "@app/db";
import { conversation, conversationEntry, type Part, parts as partsOf } from "@app/db";
import { and, asc, type ExtractTablesWithRelations, eq, isNull, max } from "drizzle-orm";
import type { PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../db";
import { isDuplicate } from "../db/duplicate";
import type { Asking } from "../session";

/**
 * A conversation and its entries (`ID162`, the spec's *The conversation*).
 *
 * What it hides: the two tables, the next position, computed inside the transaction
 * that writes it, and the unique constraint that is the guard against two opens racing.
 * What it accepts: a transaction from its caller for `append`, so an entry is written
 * with whatever else that caller writes; `open` owns its own, because a conversation and
 * its first entry are one write.
 *
 * **It knows no assistant.** Which assistant a conversation is, is a value it stores;
 * what the opening says arrives as parts, from a function called only when the
 * conversation is created (`ID189`). Parts that fail the catalogue throw before
 * anything is written.
 *
 * A path of its own and not an export of `lib/db` (`ID152`): nine test files mock that
 * module whole, and an export added there would vanish from each of them.
 */

/**
 * The transaction a caller writes in, whatever driver it is over: `lib/db`'s on a
 * deployed function, PGlite's in the suite. Typed by the schema and not by the driver, so
 * a caller holding either can hand it over.
 */
export type Transaction = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type Author = "person" | "assistant" | "tool" | "system";

export type Entry = {
  id: string;
  position: number;
  author: Author;
  parts: Part[];
  createdAt: Date;
};

export type Conversation = {
  id: string;
  userId: string;
  assistant: string;
  subject: string | null;
};

const constraint = "conversation_user_assistant_subject";

const found = async (
  person: Asking,
  assistant: string,
  subject: string | null,
  reader: Transaction | typeof db = db,
): Promise<Conversation | undefined> => {
  const [row] = await reader
    .select({
      id: conversation.id,
      userId: conversation.userId,
      assistant: conversation.assistant,
      subject: conversation.subject,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, person.id),
        eq(conversation.assistant, assistant),
        subject === null ? isNull(conversation.subject) : eq(conversation.subject, subject),
      ),
    );
  return row;
};

/**
 * The person's conversation with that assistant about that subject, as it was left, or
 * a new one whose entry 1 is the opening. A second open that lost the race to create it
 * reads the one that won.
 *
 * Given the caller's transaction (D9, W1), it reads and creates in that one, so the
 * conversation is written with whatever else the caller writes; a lost race then fails the
 * caller's whole write, since a failed statement ends the transaction it ran in.
 */
export const open = async (
  person: Asking,
  assistant: string,
  subject: string | null,
  opening: (tx: Transaction) => Promise<Part[]>,
  tx?: Transaction,
): Promise<Conversation> => {
  const create = async (writer: Transaction): Promise<Conversation> => {
    const said = partsOf.parse(await opening(writer));
    const created = { id: randomUUID(), userId: person.id, assistant, subject };
    await writer.insert(conversation).values(created);
    await writer.insert(conversationEntry).values({
      id: randomUUID(),
      conversationId: created.id,
      position: 1,
      author: "assistant",
      parts: said,
    });
    return created;
  };

  if (tx !== undefined) {
    return (await found(person, assistant, subject, tx)) ?? (await create(tx));
  }

  const existing = await found(person, assistant, subject);
  if (existing !== undefined) return existing;

  try {
    return await db.transaction(create);
  } catch (thrown) {
    if (!isDuplicate(thrown, constraint)) throw thrown;
    const winner = await found(person, assistant, subject);
    if (winner === undefined) throw thrown;
    return winner;
  }
};

/**
 * The person's conversation with that assistant about that subject, when one exists; never
 * created. What a writer outside the conversation notifies (D34).
 */
export const existing = (
  person: Asking,
  assistant: string,
  subject: string | null,
): Promise<Conversation | undefined> => found(person, assistant, subject);

/** Every entry of the conversation, in order. Parts are read as they were stored. */
export const entries = async (of: Conversation): Promise<Entry[]> =>
  db
    .select({
      id: conversationEntry.id,
      position: conversationEntry.position,
      author: conversationEntry.author,
      parts: conversationEntry.parts,
      createdAt: conversationEntry.createdAt,
    })
    .from(conversationEntry)
    .where(eq(conversationEntry.conversationId, of.id))
    .orderBy(asc(conversationEntry.position));

/** One entry written after the last, in the caller's transaction. */
export const append = async (
  tx: Transaction,
  to: Conversation,
  author: Author,
  said: Part[],
): Promise<Entry> => {
  const checked = partsOf.parse(said);
  const [last] = await tx
    .select({ position: max(conversationEntry.position) })
    .from(conversationEntry)
    .where(eq(conversationEntry.conversationId, to.id));
  const [written] = await tx
    .insert(conversationEntry)
    .values({
      id: randomUUID(),
      conversationId: to.id,
      position: (last?.position ?? 0) + 1,
      author,
      parts: checked,
    })
    .returning({
      id: conversationEntry.id,
      position: conversationEntry.position,
      author: conversationEntry.author,
      parts: conversationEntry.parts,
      createdAt: conversationEntry.createdAt,
    });
  if (written === undefined) throw new Error("the entry could not be written");
  return written;
};

/**
 * Where the agent's context was cut (D36, `ID304`): entries before `cut` are not sent, tool
 * results before `cleared` are sent as a placeholder. Absent both until a first cut.
 */
export type ContextWindow = { cut?: number; cleared?: number };

const windowOf = (
  row: { cut: number | null; cleared: number | null } | undefined,
): ContextWindow => ({
  ...(row?.cut == null ? {} : { cut: row.cut }),
  ...(row?.cleared == null ? {} : { cleared: row.cleared }),
});

/** The conversation's context window, as the agent last stored it. */
export const contextWindow = async (of: Conversation): Promise<ContextWindow> => {
  const [row] = await db
    .select({ cut: conversation.contextCut, cleared: conversation.contextCleared })
    .from(conversation)
    .where(eq(conversation.id, of.id));
  return windowOf(row);
};

/** The conversation's context window, replaced in the caller's transaction. */
export const setContextWindow = async (
  tx: Transaction,
  of: Conversation,
  window: ContextWindow,
): Promise<void> => {
  await tx
    .update(conversation)
    .set({ contextCut: window.cut ?? null, contextCleared: window.cleared ?? null })
    .where(eq(conversation.id, of.id));
};
