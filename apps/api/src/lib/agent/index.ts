import type { Part } from "@app/db";
import type { ZodType } from "zod";
import type { Transaction } from "../conversation";

/**
 * What a concrete assistant contributes to the core (`ID186`, `ID188`). Types alone in
 * this slice: the loop that reads `prompt` and runs `tools` arrives with `SL4`.
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant
 * is a value of `AssistantDefinition`, handed to the conversations route at the
 * composition root as a registry; nothing in the core names one.
 */

/** One thing the agent may do, its input validated by zod (`ID187`). */
export type AgentTool<I = unknown, R = unknown> = {
  name: string;
  description: string;
  input: ZodType<I>;
  run: (tx: Transaction, person: string, input: I) => Promise<R>;
};

/**
 * One concrete assistant: its name, which is the `:assistant` of the route; its prompt
 * and tools, read from `SL4`; and its opening, written as entry 1 when a conversation is
 * created and never again (`ID189`).
 */
export type AssistantDefinition = {
  name: string;
  prompt: string;
  tools: AgentTool[];
  opening: (tx: Transaction, person: string) => Promise<Part[]>;
};
