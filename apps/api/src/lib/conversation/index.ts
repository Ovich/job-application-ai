import { randomUUID } from "node:crypto";
import type * as schema from "@app/db";
import {
  conversation,
  conversationEntry,
  type Part,
  parts as partsOf,
  toolResultPart,
  toolUsePart,
} from "@app/db";
import { and, asc, type ExtractTablesWithRelations, eq, isNull, max } from "drizzle-orm";
import type { PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { Message } from "../ai";
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

export type Author = "person" | "assistant" | "tool";

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
): Promise<Conversation | undefined> => {
  const [row] = await db
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
 */
export const open = async (
  person: Asking,
  assistant: string,
  subject: string | null,
  opening: (tx: Transaction) => Promise<Part[]>,
): Promise<Conversation> => {
  const existing = await found(person, assistant, subject);
  if (existing !== undefined) return existing;

  try {
    return await db.transaction(async (tx) => {
      const said = partsOf.parse(await opening(tx));
      const created = { id: randomUUID(), userId: person.id, assistant, subject };
      await tx.insert(conversation).values(created);
      await tx.insert(conversationEntry).values({
        id: randomUUID(),
        conversationId: created.id,
        position: 1,
        author: "assistant",
        parts: said,
      });
      return created;
    });
  } catch (thrown) {
    if (!isDuplicate(thrown, constraint)) throw thrown;
    const winner = await found(person, assistant, subject);
    if (winner === undefined) throw thrown;
    return winner;
  }
};

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

/**
 * The conversation as the model reads it (`ID162`), in the protocol's own messages.
 *
 * The person's entry is a `user` message of its `text` parts, joined. An assistant's
 * entry is one `assistant` message: its text, and its `tool_use` parts as the calls, the
 * input written back as the arguments string the model sent. A `tool` entry is one
 * `tool` message per `tool_result`, answering its call's id with the before and after, or
 * the refusal. An entry with nothing to say is left out rather than sent empty; a part of
 * a kind this does not know is left out of the message. `SL5` adds the question parts.
 */
export const asMessages = (said: Entry[]): Message[] =>
  said.flatMap((entry): Message[] => {
    if (entry.author === "tool") {
      return entry.parts.flatMap((part): Message[] => {
        const read = toolResultPart.safeParse(part);
        if (!read.success) return [];
        const { id, before, after, refused } = read.data;
        return [
          {
            role: "tool",
            tool_call_id: id,
            content: JSON.stringify(refused === undefined ? { before, after } : { refused }),
          },
        ];
      });
    }

    const text = entry.parts
      .flatMap((part) =>
        part.kind === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
      )
      .join("\n\n");
    if (entry.author === "person") return text === "" ? [] : [{ role: "user", content: text }];

    const calls = entry.parts.flatMap((part) => {
      const read = toolUsePart.safeParse(part);
      if (!read.success) return [];
      return [
        {
          id: read.data.id,
          type: "function" as const,
          function: { name: read.data.name, arguments: JSON.stringify(read.data.input ?? {}) },
        },
      ];
    });
    if (calls.length === 0) return text === "" ? [] : [{ role: "assistant", content: text }];
    return [{ role: "assistant", content: text === "" ? null : text, tool_calls: calls }];
  });

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
