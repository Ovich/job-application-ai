import type { Part } from "@app/db";
import { AIMessage, type BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createAgent, createMiddleware } from "langchain";
import { type ZodType, z } from "zod";
import { chatModel } from "../ai";
import {
  append,
  asLangChainMessages,
  type Conversation,
  type Entry,
  entries,
  type Transaction,
} from "../conversation";
import { db } from "../db";

/**
 * The agent, and what a concrete assistant contributes to it (`ID179`, `ID186`,
 * `ID187`, `ID188`), managed by LangGraph (D18).
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant
 * is a value of `AssistantDefinition`, handed to the conversations route at the
 * composition root as a registry; nothing here names one. The prompt and the tools come
 * from the definition.
 *
 * What `run` hides: the graph (`createAgent`, one per definition, no checkpointer, D20);
 * the step middleware, which holds the step count and each step's case name, the
 * transaction per step and the entry that says the agent stopped at its limit (D21, D22);
 * and the mapping of the graph's stream onto what it yields. The model is `lib/ai`'s.
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
  /** A few words saying what this call is doing, shown while it runs (`ID210`). */
  summarise(input: I): string;
};

/**
 * What an opening throws when its conversation cannot exist yet (`ID202`): the profile's
 * before a reading. Thrown inside the transaction that would create the conversation, so
 * nothing is written; the route answers 409 with the message.
 */
export class NotYet extends Error {}

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
 * One concrete assistant: its name, which is the `:assistant` of the route; its system
 * prompt and its tools, which every step of the loop is given; and its opening, written
 * as entry 1 when a conversation is created and never again (`ID189`), or `NotYet`
 * thrown when there is nothing to open on.
 *
 * What the loop takes from it and knows nothing of itself (D10 to D12): the `context` the
 * model reads after the prompt, one string per system message, read fresh before each
 * step; the `stepPhrase` a step shows before its first words; how a part beyond text and
 * tools reads to the model, or `null` to leave it out; and, when the assistant takes
 * words about something, the part saying where they sit, or `null` when it is not the
 * person's.
 */
export type AssistantDefinition = {
  name: string;
  prompt: string;
  tools: AgentTool[];
  actions: AgentAction[];
  opening: (tx: Transaction, person: string) => Promise<Part[]>;
  context: (tx: Transaction, person: string) => Promise<string[]>;
  stepPhrase: (n: number) => string;
  describe: (part: Part) => string | null;
  about?: (tx: Transaction, person: string, input: About) => Promise<Part | null>;
};

/** What a person's words are about, as the browser names it: an item, and a line of it or none. */
export type About = { itemId: string; lineId?: string | undefined };

/**
 * What the loop says as it runs: what it is doing now, in a short phrase (`ID210`), never
 * stored; a piece of a step's text; or an entry it committed.
 */
export type Ran =
  | { kind: "activity"; text: string }
  | { kind: "text"; text: string }
  | { kind: "entry"; entry: Entry };

/** How many steps one message may take (`ID180`). */
export const stepLimit = 5;

/** The last entry when the limit is reached. What the steps committed stays. */
const stopped = `I stopped here: one message may take ${stepLimit} steps and I reached that limit. What I changed so far is kept.`;

/** One call of a step, as the step middleware reads it from the model's message. */
type Call = { id: string; name: string; args: unknown; written: string };

/** The called tool's own summary of a call, or nothing for a call it would refuse. */
const summaryOf = (definition: AssistantDefinition, call: Call): string | null => {
  const tool = definition.tools.find((each) => each.name === call.name);
  const input = tool?.input.safeParse(call.args);
  return tool === undefined || input === undefined || !input.success
    ? null
    : tool.summarise(input.data);
};

/** What one call did, as the `tool_result` part that records it. A refusal is a value. */
const resultOf = async (
  tx: Transaction,
  definition: AssistantDefinition,
  person: string,
  call: Call,
): Promise<Part> => {
  const said = { kind: "tool_result", id: call.id, name: call.name };
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
  return "refused" in outcome
    ? { ...said, refused: outcome.refused }
    : { ...said, before: outcome.before, after: outcome.after };
};

/** The run's context: the person, and the conversation in its own shape (spec 3.4). */
const contextSchema = z.object({
  person: z.string(),
  conversation: z.object({
    id: z.string(),
    userId: z.string(),
    assistant: z.string(),
    subject: z.string().nullable(),
  }),
});

type RunContext = z.infer<typeof contextSchema>;

/** The step middleware's own state: the step count, and the step's results by call id. */
const stepState = z.object({
  step: z.number().default(0),
  results: z.record(z.string(), z.custom<ToolMessage>()).default({}),
});

/** The case a step is asked as, `<assistant>.message:<conversation id>#<n>` (`ID182`). */
const caseOf = (definition: AssistantDefinition, context: RunContext, n: number): string =>
  `${definition.name}.message:${context.conversation.id}#${n}`;

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
const callsOf = (message: AIMessage, named: string): Call[] => {
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

/** What a `tool_result` part says to the model, as the conversation renders it (spec 3.3). */
const resultMessage = (part: Part): ToolMessage => {
  const { id, name, refused, before, after } = part as Part & {
    id: string;
    name: string;
    refused?: string;
    before?: unknown;
    after?: unknown;
  };
  return new ToolMessage({
    tool_call_id: id,
    name,
    content: JSON.stringify(refused === undefined ? { before, after } : { refused }),
  });
};

/**
 * The model's own message as the next call sends it back: the model node names every
 * message it answers, and the converter would put that name on the wire, where the loop
 * sent none. Only the request's copy loses it; the state keeps the message as it is.
 */
const unnamed = (message: BaseMessage): BaseMessage =>
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

/**
 * The step middleware (D21, D22, D26; spec 3.5): the step count and its phrase, the step
 * limit, the context and the case header per model call, and the step's one transaction.
 *
 * **No transaction is open while the model is asked** (`ID179`): the context is read in
 * its own short transaction before the handler is called, and the step's transaction
 * opens in `afterModel`, once the model's answer is whole.
 */
const stepMiddleware = (definition: AssistantDefinition) =>
  createMiddleware({
    name: "step",
    stateSchema: stepState,
    contextSchema,
    beforeModel: {
      canJumpTo: ["end"],
      hook: async (state, runtime) => {
        const context = runtime.context as RunContext;
        const say = (ran: Ran) => runtime.writer?.(ran);
        // Every tool message of the last step must be one this middleware returned: a
        // missing result is a defect the tools node would hand the model as an error.
        if (state.step > 0) {
          const asked = state.messages.findLastIndex((message) => AIMessage.isInstance(message));
          for (const message of state.messages.slice(asked + 1)) {
            if (!ToolMessage.isInstance(message)) continue;
            const kept = state.results[message.tool_call_id];
            if (
              kept === undefined ||
              message.status === "error" ||
              kept.content !== message.content
            ) {
              throw new Error(
                `The step ${caseOf(definition, context, state.step)} has no result for the call ${message.tool_call_id}`,
              );
            }
          }
        }
        const n = state.step + 1;
        if (n > stepLimit) {
          const last = await db.transaction((tx) =>
            append(tx, context.conversation, "assistant", [{ kind: "text", text: stopped }]),
          );
          say({ kind: "entry", entry: last });
          return { jumpTo: "end" };
        }
        say({ kind: "activity", text: definition.stepPhrase(n) });
        return { step: n, results: {} };
      },
    },
    wrapModelCall: async (request, handler) => {
      const context = request.runtime.context as RunContext;
      // The definition's context, read fresh before each call (D10), never put in the state.
      const said = await db.transaction((tx) => definition.context(tx, context.person));
      const caseHeader = { "X-Jobapp-Case": caseOf(definition, context, request.state.step) };
      // The streamed path forwards a top-level `headers`, the unstreamed one
      // `options.headers` (D26, `ID282`); neither is in the call options' type.
      const modelSettings: unknown = { headers: caseHeader, options: { headers: caseHeader } };
      return handler({
        ...request,
        messages: [
          ...said.map((text) => new SystemMessage(text)),
          ...request.messages.map(unnamed),
        ],
        modelSettings: modelSettings as Record<string, unknown>,
      });
    },
    afterModel: async (state, runtime) => {
      const context = runtime.context as RunContext;
      const say = (ran: Ran) => runtime.writer?.(ran);
      const message = state.messages.at(-1);
      if (message === undefined || !AIMessage.isInstance(message)) {
        throw new Error("the step ended on a message that is not the model's");
      }
      const calls = callsOf(message, caseOf(definition, context, state.step));
      const text = typeof message.content === "string" ? message.content : "";

      if (calls.length === 0) {
        const reply = await db.transaction((tx) =>
          append(tx, context.conversation, "assistant", [{ kind: "text", text }]),
        );
        say({ kind: "entry", entry: reply });
        return;
      }

      for (const call of calls) {
        const summary = summaryOf(definition, call);
        if (summary !== null) say({ kind: "activity", text: summary });
      }

      const { written, parts } = await db.transaction(async (tx) => {
        const parts: Part[] = [];
        for (const call of calls) parts.push(await resultOf(tx, definition, context.person, call));
        const asked = await append(tx, context.conversation, "assistant", [
          ...(text === "" ? [] : [{ kind: "text", text }]),
          ...calls.map((call) => ({
            kind: "tool_use",
            id: call.id,
            name: call.name,
            input: call.args,
            arguments: call.written,
          })),
        ]);
        const answered = await append(tx, context.conversation, "tool", parts);
        return { written: [asked, answered], parts };
      });
      for (const entry of written) say({ kind: "entry", entry });

      return {
        results: Object.fromEntries(
          calls.map((call, at) => [call.id, resultMessage(parts[at] as Part)]),
        ),
      };
    },
    wrapToolCall: async (request) => {
      const kept = request.state.results[request.toolCall.id ?? ""];
      if (kept === undefined) {
        throw new Error(`The step has no result for the call ${request.toolCall.id}`);
      }
      return kept;
    },
  });

/** The graph for a definition (spec 3.4). */
const build = (definition: AssistantDefinition) =>
  createAgent({
    model: chatModel(),
    // A message of one string, as the loop sent it: a plain string would become a list of
    // text blocks on the wire. An empty prompt still sends nothing (`AgentNode.js:149`).
    systemPrompt: new SystemMessage(definition.prompt),
    tools: definition.tools.map((each) =>
      tool(
        () => {
          // Never reached, and it must stay a throw (D21). The step middleware runs every
          // call in `afterModel`, in the step's one transaction with both entries, and
          // `wrapToolCall` hands the tools node the recorded result. An edit made here, the
          // framework's own idiom, would commit on its own: a step of two calls would
          // become two `tool` entries, and a call's entry could stand while its edit failed.
          throw new Error("never run: the step middleware runs every tool");
        },
        { name: each.name, description: each.description, schema: each.input as never },
      ),
    ),
    contextSchema,
    middleware: [stepMiddleware(definition)],
    name: definition.name,
  });

type Agent = ReturnType<typeof build>;

/** One graph per definition: stateless without a checkpointer, so one serves every request. */
const agents = new Map<AssistantDefinition, Agent>();

const agentOf = (definition: AssistantDefinition): Agent => {
  const known = agents.get(definition);
  if (known !== undefined) return known;
  const built = build(definition);
  agents.set(definition, built);
  return built;
};

/**
 * One message through the agent (spec 3.6): the stored entries as its input (D11, D20),
 * then what the graph streams, mapped onto `Ran` in the order it arrives. The step
 * middleware's `custom` events are already `Ran`s; the model node's text pieces become
 * `text` (D28). Both modes are needed: `messages` is what makes the model stream at all.
 *
 * A failed call, or a step whose transaction fails, throws after yielding what earlier
 * steps committed; nothing of the failed step is written.
 */
export async function* run(
  definition: AssistantDefinition,
  conversation: Conversation,
  person: string,
): AsyncIterable<Ran> {
  const messages = asLangChainMessages(await entries(conversation), definition.describe);
  const stream = await agentOf(definition).stream(
    { messages },
    {
      context: { person, conversation },
      streamMode: ["messages", "custom"],
      // A safety net a run never reaches: `beforeModel` ends it after `stepLimit` steps.
      recursionLimit: 10 * stepLimit,
    },
  );
  for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
    if (mode === "custom") {
      yield chunk as Ran;
      continue;
    }
    const [piece, metadata] = chunk as [BaseMessage, { langgraph_node?: string }];
    if (
      metadata.langgraph_node === "model_request" &&
      typeof piece.content === "string" &&
      piece.content !== ""
    ) {
      yield { kind: "text", text: piece.content };
    }
  }
}
