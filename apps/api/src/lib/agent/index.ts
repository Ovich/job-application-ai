import type { Part } from "@app/db";
import { type ZodType, z } from "zod";
import type { Ai, Message, Tool, ToolCall } from "../ai";
import {
  append,
  asMessages,
  type Conversation,
  type Entry,
  entries,
  type Transaction,
} from "../conversation";
import { db } from "../db";
import { itemsOf } from "../profile-edit";

/**
 * The agent loop, and what a concrete assistant contributes to it (`ID179`, `ID186`,
 * `ID187`, `ID188`).
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant
 * is a value of `AssistantDefinition`, handed to the conversations route at the
 * composition root as a registry; nothing here names one. The prompt and the tools come
 * from the definition.
 *
 * What `run` hides: the step count and each step's case name, the JSON schema derived
 * from each tool's input, the transaction per step, and the entry that says the loop
 * stopped at its limit. It accepts `ai` as a value and reads no environment.
 *
 * **No transaction is open while the model is asked** (`ID179`): `lib/db` holds one
 * connection, and a transaction held across a model call would block every other query
 * of the request. The conversation and the profile are read before a step asks, each in
 * its own short read; a step's calls, its assistant entry and its tool entry are one
 * transaction once its answer is whole. An entry is yielded only after it committed.
 */

/** What a tool did: the thing it changed, before and after, or why it refused. */
export type ToolOutcome =
  { before: Record<string, unknown>; after: Record<string, unknown> } | { refused: string };

/**
 * One thing the agent may do, its input validated by zod (`ID187`). `run` is written as
 * a method so a tool typed by its own input still takes its place in a definition's
 * list of tools.
 */
export type AgentTool<I = unknown, R extends ToolOutcome = ToolOutcome> = {
  name: string;
  description: string;
  input: ZodType<I>;
  run(tx: Transaction, person: string, input: I): Promise<R>;
};

/**
 * What an opening throws when its conversation cannot exist yet (`ID202`): the profile's
 * before a reading. Thrown inside the transaction that would create the conversation, so
 * nothing is written; the route answers 409 with the message.
 */
export class NotYet extends Error {}

/**
 * One concrete assistant: its name, which is the `:assistant` of the route; its system
 * prompt and its tools, which every step of the loop is given; and its opening, written
 * as entry 1 when a conversation is created and never again (`ID189`), or `NotYet`
 * thrown when there is nothing to open on.
 */
export type AssistantDefinition = {
  name: string;
  prompt: string;
  tools: AgentTool[];
  opening: (tx: Transaction, person: string) => Promise<Part[]>;
};

/** What the loop says as it runs: a piece of a step's text, or an entry it committed. */
export type Ran = { kind: "text"; text: string } | { kind: "entry"; entry: Entry };

/** How many steps one message may take (`ID180`). */
export const stepLimit = 5;

/** The last entry when the limit is reached. What the steps committed stays. */
const stopped = `I stopped here: one message may take ${stepLimit} steps and I reached that limit. What I changed so far is kept.`;

/** The tools as a call offers them: the JSON schema derived from each input, never written. */
const offered = (definition: AssistantDefinition): Tool[] =>
  definition.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.input),
  }));

/**
 * The profile as it stands, as the model reads it (`ID193`): a system message after the
 * prompt, read fresh before each step in its own short read, so a step sees what the
 * step before it changed.
 */
const theProfile = async (person: string): Promise<Message> => {
  const items = await db.transaction((tx) => itemsOf(tx, person));
  return {
    role: "system",
    content: `The person's profile as it stands, as JSON. Every item, and every line of an item, carries the id an edit names it by.\n${JSON.stringify(items)}`,
  };
};

/** What one call did, as the `tool_result` part that records it. A refusal is a value. */
const resultOf = async (
  tx: Transaction,
  definition: AssistantDefinition,
  person: string,
  call: ToolCall,
): Promise<Part> => {
  const said = { kind: "tool_result", id: call.id, name: call.name };
  const tool = definition.tools.find((each) => each.name === call.name);
  if (tool === undefined) return { ...said, refused: `There is no tool named ${call.name}.` };
  const input = tool.input.safeParse(call.arguments);
  if (!input.success) {
    return {
      ...said,
      refused: `The input does not fit ${call.name}: ${z.prettifyError(input.error)}`,
    };
  }
  const outcome = await tool.run(tx, person, input.data);
  return "refused" in outcome
    ? { ...said, refused: outcome.refused }
    : { ...said, before: outcome.before, after: outcome.after };
};

/**
 * The loop (`ID187`): ask, stream the step's text on, apply the step's calls and write
 * its entries in one transaction, give the results back, until a step with no call, which
 * is written as the last assistant entry — or until the step limit, which says so.
 *
 * A failed call, or a step whose transaction fails, throws after yielding what earlier
 * steps committed; nothing of the failed step is written.
 */
export async function* run(
  definition: AssistantDefinition,
  conversation: Conversation,
  person: string,
  ai: Ai,
): AsyncIterable<Ran> {
  const tools = offered(definition);

  for (let n = 1; n <= stepLimit; n += 1) {
    const messages: Message[] = [
      ...(definition.prompt === ""
        ? []
        : [{ role: "system" as const, content: definition.prompt }]),
      await theProfile(person),
      ...asMessages(await entries(conversation)),
    ];
    const step = ai.askWithTools(
      messages,
      { feature: definition.name, step: "message", input: `${conversation.id}#${n}` },
      tools,
    );

    let text = "";
    for await (const piece of step.pieces) {
      text += piece;
      yield { kind: "text", text: piece };
    }
    const calls = await step.calls;

    if (calls.length === 0) {
      const reply = await db.transaction((tx) =>
        append(tx, conversation, "assistant", [{ kind: "text", text }]),
      );
      yield { kind: "entry", entry: reply };
      return;
    }

    const written = await db.transaction(async (tx) => {
      const results: Part[] = [];
      for (const call of calls) results.push(await resultOf(tx, definition, person, call));
      const asked = await append(tx, conversation, "assistant", [
        ...(text === "" ? [] : [{ kind: "text", text }]),
        ...calls.map((call) => ({
          kind: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        })),
      ]);
      const answered = await append(tx, conversation, "tool", results);
      return [asked, answered];
    });
    for (const entry of written) yield { kind: "entry", entry };
  }

  const last = await db.transaction((tx) =>
    append(tx, conversation, "assistant", [{ kind: "text", text: stopped }]),
  );
  yield { kind: "entry", entry: last };
}
