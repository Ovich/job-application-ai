import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AgentPart, AssistantDefinition } from "./index";

/**
 * A step's calls: what the model asked for, and what each call did.
 *
 * Nothing here writes. `resultOf` runs the definition's tool inside the transaction the
 * step middleware opened, and answers with the part that records the call, a refusal
 * included: a tool that will not do what it was asked is a value, never a throw.
 */

/** One call of a step, as the step middleware reads it from the model's message. */
export type Call = { id: string; name: string; args: unknown; written: string };

/** The called tool's own summary of a call, or nothing for a call it would refuse. */
export const summaryOf = <Tx>(definition: AssistantDefinition<Tx>, call: Call): string | null => {
  const tool = definition.tools.find((each) => each.name === call.name);
  const input = tool?.input.safeParse(call.args);
  return tool === undefined || input === undefined || !input.success
    ? null
    : tool.summarise(input.data);
};

/** What one call did, as the `tool_result` part that records it. A refusal is a value. */
export const resultOf = async <Tx>(
  tx: Tx,
  definition: AssistantDefinition<Tx>,
  person: string,
  call: Call,
): Promise<Extract<AgentPart, { kind: "tool_result" }>> => {
  const said = { kind: "tool_result" as const, id: call.id, name: call.name };
  const tool = definition.tools.find((each) => each.name === call.name);
  if (tool === undefined) return { ...said, refused: `There is no tool named ${call.name}.` };
  const input = tool.input.safeParse(call.args);
  if (!input.success) {
    return {
      ...said,
      refused: `The input does not fit ${call.name}: ${z.prettifyError(input.error)}`,
    };
  }
  const outcome = await tool.run(tx, person, input.data);
  if ("refused" in outcome) return { ...said, refused: outcome.refused };
  if ("read" in outcome) return { ...said, read: outcome.read };
  return { ...said, before: outcome.before, after: outcome.after };
};

/**
 * A call's arguments string as the model wrote it (`ID206`, D23): the streamed deltas'
 * strings, concatenated by the library into `additional_kwargs`, or the call's own chunk
 * when that record is missing.
 */
const writtenOf = (message: AIMessage, id: string): string | undefined => {
  const raw = message.additional_kwargs["tool_calls"] as
    { id?: string; function?: { arguments?: string } }[] | undefined;
  const kept = raw?.find((each) => each.id === id)?.function?.arguments;
  if (typeof kept === "string") return kept;
  const chunks = (message as { tool_call_chunks?: { id?: string; args?: string }[] })
    .tool_call_chunks;
  return chunks?.find((each) => each.id === id)?.args;
};

/**
 * The step's calls, each with its arguments string; or a throw when a call's arguments
 * are not JSON (migration `O6`, spec section 7, `ID283`), whether the library filed the
 * call under `invalid_tool_calls` or read a cut-short string as partial JSON.
 */
export const callsOf = (message: AIMessage, named: string): Call[] => {
  const notJson = (name: string | undefined, cause?: unknown) =>
    new Error(
      `The AI call about ${named} failed: the arguments of ${name ?? "a call"} are not JSON`,
      { cause },
    );
  const broken = message.invalid_tool_calls?.[0];
  if (broken !== undefined) throw notJson(broken.name);
  return (message.tool_calls ?? []).map((call) => {
    const id = call.id ?? "";
    const raw = writtenOf(message, id) ?? JSON.stringify(call.args);
    const written = raw === "" ? "{}" : raw;
    try {
      JSON.parse(written);
    } catch (cause) {
      throw notJson(call.name, cause);
    }
    return { id, name: call.name, args: call.args, written };
  });
};
