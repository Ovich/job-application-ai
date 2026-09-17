import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentPart, AssistantDefinition, StoredEntry } from "./index";

/**
 * The conversation as the model reads it (`ID162`, spec 3.3, `ID272`, OD7), as
 * `@langchain/core` messages, and one call's answer as the step middleware hands it back.
 *
 * Entries are the only history (D20): what a step is asked is built here, from the stored
 * entries alone. The module reads of a part only what it wrote itself; a part it does not
 * know is the definition's to word, or nothing.
 */

/** A `tool_use` part as this module reads one back, whatever else the store kept on it. */
const toolUsePart = z.object({
  kind: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  arguments: z.string().optional(),
});

/** A `tool_result` part as this module reads one back: before and after, a refusal, or a read. */
const toolResultPart = z
  .object({
    kind: z.literal("tool_result"),
    id: z.string().min(1),
    name: z.string().min(1),
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    refused: z.string().optional(),
    read: z.unknown().optional(),
  })
  .refine((result) => {
    const edited = result.before !== undefined && result.after !== undefined;
    const halfEdited = (result.before === undefined) !== (result.after === undefined);
    const outcomes = [edited, result.refused !== undefined, result.read !== undefined];
    return !halfEdited && outcomes.filter(Boolean).length === 1;
  }, "a tool_result carries before and after, or a refusal, or a read, never two");

/** How a part beyond plain text reads to the model, as the definition words it (D11). */
type Describe = AssistantDefinition<never>["describe"];

/**
 * One part of the person's entry, in the words the model reads (`S7.2`): their text as it
 * is, and any other part as the definition's `describe` words it (D11). A part it answers
 * `null` for says nothing.
 */
const personSays =
  (describe: Describe) =>
  (part: Record<string, unknown>): string[] => {
    if (part["kind"] === "text" && typeof part["text"] === "string") return [part["text"]];
    const described = describe(part);
    return described === null ? [] : [described];
  };

/** A tool call's arguments as the model reads them back: an object, as `tool_calls` wants. */
type Args = Record<string, unknown>;

/**
 * A value as JSON with every object's keys in one order, the code-unit order: a stored
 * part is a `jsonb` value, which keeps no key order, so the read a step hands the model and
 * the same read given back from the store on a later message are the same bytes (D33).
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, held: unknown) =>
    typeof held === "object" && held !== null && !Array.isArray(held)
      ? Object.fromEntries(
          Object.entries(held).sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0)),
        )
      : held,
  );

/**
 * What a `tool_result` says to the model: the thing before and after, the refusal, or
 * what was read, which is the tool message's whole content.
 */
const said = (result: {
  refused?: string | undefined;
  before?: unknown;
  after?: unknown;
  read?: unknown;
}): string => {
  if (result.read !== undefined) return canonical(result.read);
  return JSON.stringify(
    result.refused === undefined
      ? { before: result.before, after: result.after }
      : { refused: result.refused },
  );
};

/**
 * The conversation as the agent reads it (`ID162`, spec 3.3, `ID272`).
 *
 * The person's entry is a `HumanMessage` of its parts, `describe` wording or leaving out
 * a part that is not text (D11). An assistant's entry is one `AIMessage`: its text, and
 * its `tool_use` parts as the calls. A `tool` entry is one `ToolMessage` per
 * `tool_result`, answering its call's id with the before and after, the refusal, or the
 * read. An
 * entry with nothing to say is left out rather than sent empty.
 *
 * A call's `args` are the model's own arguments string, parsed: the key order is kept and
 * only whitespace is dropped, since the converter serialises `args` again (D23). The
 * message is built with `tool_calls` and nothing in `additional_kwargs`, so it neither
 * parses them itself nor warns.
 */
export const asMessages = (entries: readonly StoredEntry[], describe: Describe): BaseMessage[] =>
  entries.flatMap((entry): BaseMessage[] => {
    if (entry.author === "tool") {
      return entry.parts.flatMap((part): BaseMessage[] => {
        const read = toolResultPart.safeParse(part);
        if (!read.success) return [];
        const { id, name } = read.data;
        return [new ToolMessage({ tool_call_id: id, name, content: said(read.data) })];
      });
    }

    if (entry.author === "person") {
      const says = entry.parts.flatMap(personSays(describe)).join("\n\n");
      return says === "" ? [] : [new HumanMessage(says)];
    }

    const text = entry.parts
      .flatMap((part) =>
        part["kind"] === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
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

/** What one call did, as the message that answers it inside the step that made it. */
export const resultMessage = (part: Extract<AgentPart, { kind: "tool_result" }>): ToolMessage =>
  new ToolMessage({ tool_call_id: part.id, name: part.name, content: said(part) });

/**
 * The model's own message as the next call sends it back: the model node names every
 * message it answers, and the converter would put that name on the wire, where the loop
 * sent none. Only the request's copy loses it; the state keeps the message as it is.
 */
export const unnamed = (message: BaseMessage): BaseMessage =>
  AIMessage.isInstance(message) && message.name !== undefined
    ? new AIMessage({
        ...(message.id === undefined ? {} : { id: message.id }),
        content: message.content as string,
        tool_calls: (message.tool_calls ?? []).map(({ id, name, args }) => ({
          ...(id === undefined ? {} : { id }),
          name,
          args,
          type: "tool_call" as const,
        })),
      })
    : message;
