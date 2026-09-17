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
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
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
 * One part of the person's entry, in the words the model reads (`S7.2`): their text as it
 * is, and any other part as the assistant's `describe` words it (D11). A part it answers
 * `null` for says nothing.
 */
const personSays =
  (describe: (part: Part) => string | null) =>
  (part: Part): string[] => {
    if (part.kind === "text" && typeof part["text"] === "string") return [part["text"]];
    const described = describe(part);
    return described === null ? [] : [described];
  };

/** A tool call's arguments as the model reads them back: an object, as `tool_calls` wants. */
type Args = Record<string, unknown>;

/**
 * The conversation as the agent reads it (`ID162`, spec 3.3, `ID272`), as `@langchain/core`
 * messages.
 *
 * The person's entry is a `HumanMessage` of its parts, `describe` wording or leaving out
 * a part that is not text (D11). An assistant's entry is one `AIMessage`: its text, and
 * its `tool_use` parts as the calls. A `tool` entry is one `ToolMessage` per
 * `tool_result`, answering its call's id with the before and after, or the refusal. An
 * entry with nothing to say is left out rather than sent empty.
 *
 * A call's `args` are the model's own arguments string, parsed: the key order is kept and
 * only whitespace is dropped, since the converter serialises `args` again (D23). The
 * message is built with `tool_calls` and nothing in `additional_kwargs`, so it neither
 * parses them itself nor warns.
 */
export const asMessages = (said: Entry[], describe: (part: Part) => string | null): BaseMessage[] =>
  said.flatMap((entry): BaseMessage[] => {
    if (entry.author === "tool") {
      return entry.parts.flatMap((part): BaseMessage[] => {
        const read = toolResultPart.safeParse(part);
        if (!read.success) return [];
        const { id, name, before, after, refused } = read.data;
        return [
          new ToolMessage({
            tool_call_id: id,
            name,
            content: JSON.stringify(refused === undefined ? { before, after } : { refused }),
          }),
        ];
      });
    }

    if (entry.author === "person") {
      const says = entry.parts.flatMap(personSays(describe)).join("\n\n");
      return says === "" ? [] : [new HumanMessage(says)];
    }

    const text = entry.parts
      .flatMap((part) =>
        part.kind === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
      )
      .join("\n\n");
    const calls = entry.parts.flatMap((part) => {
      const read = toolUsePart.safeParse(part);
      if (!read.success) return [];
      const { id, name, input, arguments: written } = read.data;
      const args = (written === undefined ? (input ?? {}) : JSON.parse(written)) as Args;
      return [{ id, name, args, type: "tool_call" as const }];
    });
    if (calls.length === 0) return text === "" ? [] : [new AIMessage(text)];
    return [new AIMessage({ content: text, tool_calls: calls })];
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
