import { conversationEntry } from "@app/db";
import { asc, eq } from "drizzle-orm";
import { ConversationAgent, type ConversationAgentOptions } from "../../src/lib/agent";
import {
  append,
  type Conversation,
  type Entry,
  open as openIn,
  type Transaction,
} from "../../src/lib/conversation";
import type { Asking } from "../../src/lib/session";
import { chatModelThroughTheApp } from "./ai";
import { testDb } from "./database";

/**
 * The agent as a test builds it (`ID298`): the same three collaborators `app.ts` passes,
 * with the test database's transaction and the mock-backed model in their place.
 *
 * `lib/agent` imports no database and no model since the rework, so a test stands nothing
 * in: it hands the agent what it wants it to have. `entries` is the one query repeated
 * here rather than imported, because `lib/conversation`'s reads through `lib/db`'s one
 * connection and this suite's rows are in PGlite.
 */

/** The conversation's entries, in order, read from the test database. */
export const entries = async (of: Conversation): Promise<Entry[]> =>
  testDb
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

/** `lib/conversation`'s own open, in a transaction of the test database. */
export const open = (
  person: Asking,
  assistant: string,
  subject: string | null,
  opening: (tx: Transaction) => Promise<Parameters<typeof append>[3]>,
): Promise<Conversation> =>
  testDb.transaction((tx) => openIn(person, assistant, subject, opening, tx));

export { append };

/** The store the agent is handed: this suite's read, and `lib/conversation`'s own write. */
export const conversationStore = { entries, append };

/** The transaction the agent commits a step in: the test database's. */
export const transaction = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
  testDb.transaction(run);

type Options = ConversationAgentOptions<Transaction, Conversation, Entry>;

/** The agent as `app.ts` builds it, on the test database and the mock-backed model. */
export const agentOn = (
  overrides: Partial<Options> = {},
): ConversationAgent<Transaction, Conversation, Entry> =>
  new ConversationAgent({
    model: chatModelThroughTheApp(),
    store: conversationStore,
    transaction,
    caseHeader: "X-Jobapp-Case",
    ...overrides,
  });
