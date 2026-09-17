import type { Part } from "@app/db";
import type { ZodType } from "zod";
import type { AssistantDefinition, ConversationAgent } from "../agent";
import type { Conversation, Entry, Transaction } from "../conversation";

/**
 * The person-side contract of a concrete assistant (OD5): everything a definition carries
 * that the agent's loop never touches.
 *
 * `lib/agent` is a library in waiting and knows no application (`AGENTS.md` rule 8); this
 * module is the project's own, and names the project's transaction, its parts and its
 * entries. A concrete assistant is the two halves together: `AssistantDefinition` is what
 * the loop reads, and `Assistant` below is what the conversations route is handed.
 */

/**
 * What an opening throws when its conversation cannot exist yet (`ID202`): the profile's
 * before a reading. Thrown inside the transaction that would create the conversation, so
 * nothing is written; the route answers 409 with the message.
 */
export class NotYet extends Error {}

/**
 * What an action throws when it will not do what it was asked (D9, `ID246`): 404 for a
 * thing that is not the person's, 400 for an input that says nothing it can keep. The
 * transaction rolls back and the route answers the status with the message.
 */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

/**
 * What a person does with a concrete assistant's own tool (D9): answering a question it
 * asked, putting it off. Never offered to the model. `run` writes in the transaction that
 * also opens the conversation and appends the person's entry, and returns that entry's parts.
 */
export type AgentAction<I = unknown> = {
  name: string;
  input: ZodType<I>;
  run(tx: Transaction, person: string, input: I): Promise<Part[]>;
};

/** What a person's words are about, as the browser names it: an item, and a line of it or none. */
export type About = { itemId: string; lineId?: string | undefined };

/**
 * The half of a definition the loop never reads: its opening, written as entry 1 when a
 * conversation is created and never again (`ID189`), or `NotYet` thrown when there is
 * nothing to open on; the person's own tools; and, when the assistant takes words about
 * something, the part saying where they sit, or `null` when it is not the person's.
 */
export type PersonSide = {
  actions: AgentAction[];
  opening: (tx: Transaction, person: string) => Promise<Part[]>;
  about?: (tx: Transaction, person: string, input: About) => Promise<Part | null>;
};

/** One concrete assistant of this project: the loop's half and the person's, together. */
export type Assistant = AssistantDefinition<Transaction> & PersonSide;

/** The agent this project's composition root builds, as its callers are handed it. */
export type ConversationsAgent = ConversationAgent<Transaction, Conversation, Entry>;
