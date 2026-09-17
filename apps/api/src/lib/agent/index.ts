import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ZodType } from "zod";

/**
 * The agent's only entry (`ID298`): the `ConversationAgent` class and the types a
 * definition is written against, as signatures. The bodies are in `agent.ts`, `step.ts`,
 * `calls.ts` and `messages.ts`, and nothing outside this folder reaches them.
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant is
 * a value of `AssistantDefinition`, handed to `run`; nothing here names one. The prompt
 * and the tools come from the definition.
 *
 * **It knows no application.** The model, the conversation's store and the transaction
 * are options a binding passes (`AGENTS.md` rules 7 and 8); nothing under this folder
 * imports from an application, reads the environment or names a product. What it hides:
 * the graph (`createAgent`, one per definition, no checkpointer, D20); the step
 * middleware, which holds the step count and each step's case name, the transaction per
 * step and the entry that says the agent stopped at its limit (D21, D22); the entries
 * read back as messages; and the mapping of the graph's stream onto what `run` yields.
 *
 * **No transaction is open while the model is asked** (`ID179`): the caller's connection
 * may be one, and a transaction held across a model call would block every other query of
 * the request. The conversation is read before the first step asks, in its own short
 * read; a step's calls, its assistant entry and its tool entry are
 * one transaction once its answer is whole. An entry is yielded only after it committed.
 */

/** What a tool did: the thing it changed, before and after, why it refused, or what it read. */
export type ToolOutcome =
  | { before: Record<string, unknown>; after: Record<string, unknown> }
  | { refused: string }
  | { read: unknown };

/**
 * One thing the agent may do, its input validated by zod (`ID187`). `Tx` is the caller's
 * transaction. `run` is written as a method so a tool typed by its own input still takes
 * its place in a definition's list of tools.
 */
export type AgentTool<Tx, I = unknown, R extends ToolOutcome = ToolOutcome> = {
  name: string;
  description: string;
  input: ZodType<I>;
  run(tx: Tx, person: string, input: I): Promise<R>;
  /** A few words saying what this call is doing, shown while it runs (`ID210`). */
  summarise(input: I): string;
};

/**
 * One concrete assistant: what the loop takes from it, and nothing of the project (D10 to
 * D12). Its `name` is the `:assistant` of a route and the first half of a step's case;
 * `stepPhrase` is what a step shows before its first words. Nothing volatile is sent ahead
 * of the history (D33): what the agent needs to know of the world, it reads with a tool.
 */
export type AssistantDefinition<Tx> = {
  name: string;
  prompt: string;
  tools: AgentTool<Tx>[];
  stepPhrase: (n: number) => string;
  /** A person's part beyond plain text, in the words the model reads; null for one it does not. */
  describe: (part: Record<string, unknown>) => string | null;
};

/** The parts the module itself writes and reads back (OD3); the project's catalogue may hold more. */
export type AgentPart =
  | { kind: "text"; text: string }
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input?: unknown;
      arguments?: string;
    }
  | {
      kind: "tool_result";
      id: string;
      name: string;
      before?: unknown;
      after?: unknown;
      refused?: string;
      read?: unknown;
    }
  | { kind: "notice"; text: string };

/** The least the module reads of a conversation and of a stored entry; the project's own types extend them. */
export type ConversationRef = { id: string };
export type StoredEntry = {
  author: "person" | "assistant" | "tool" | "system";
  parts: readonly Record<string, unknown>[];
};

/** What the loop says as it runs. `E` is the project's entry, yielded as the store returned it. */
export type Ran<E extends StoredEntry = StoredEntry> =
  { kind: "activity"; text: string } | { kind: "text"; text: string } | { kind: "entry"; entry: E };

/** What the module needs of a conversation's store: read, and write inside the caller's transaction. */
export type ConversationStore<Tx, C extends ConversationRef, E extends StoredEntry> = {
  entries: (of: C) => Promise<E[]>;
  append: (
    tx: Tx,
    of: C,
    author: "assistant" | "tool" | "system",
    parts: AgentPart[],
  ) => Promise<E>;
};

export type ConversationAgentOptions<Tx, C extends ConversationRef, E extends StoredEntry> = {
  model: BaseChatModel;
  store: ConversationStore<Tx, C, E>;
  transaction: <T>(run: (tx: Tx) => Promise<T>) => Promise<T>;
  /** The header each step names its case in. Default `x-agent-case`. */
  caseHeader?: string;
  /** How a step's case reads. Default `<assistant>.message:<conversation>#<n>`. */
  caseOf?: (assistant: string, conversation: string, step: number) => string;
  /** How many steps one message may take. Default 5. */
  steps?: number;
  /** The last entry when the limit is reached. Default names the limit in English. */
  stopped?: (steps: number) => string;
};

export { ConversationAgent } from "./agent";
