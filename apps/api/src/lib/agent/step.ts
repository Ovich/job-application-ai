import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { z } from "zod";
import { callsOf, resultOf, summaryOf } from "./calls";
import { fitted, type Ledger } from "./context";
import type {
  AgentPart,
  AssistantDefinition,
  ConversationRef,
  ConversationStore,
  Ran,
  StoredEntry,
} from "./index";
import { resultMessage, unnamed } from "./messages";

/**
 * **The step middleware's transaction is the only writer (D21).** One transaction per step
 * holds the assistant's entry, the tools' writes and the tool entry, so a step is whole or
 * nothing of it is. The graph's own tools node never runs a tool: every call is run here,
 * in `afterModel`, and `wrapToolCall` hands the node the result this middleware recorded.
 * An edit made in the node, the framework's own idiom, would commit on its own — a step of
 * two calls would become two tool entries, and a call's entry could stand while its edit
 * failed.
 *
 * Beside that (D22, D26; spec 3.5): the step count and its phrase, the step limit, and
 * the case header per model call, and the context budget each call is fitted to (D36). The profile is no longer read before a call (D33): the
 * agent reads it with a tool, and a read is a step's call like any other.
 *
 * **No transaction is open while the model is asked** (`ID179`): the step's transaction
 * opens in `afterModel`, once the model's answer is whole.
 */

/** What the middleware was given of the outside: the store, the transaction, the wording. */
export type Wiring<Tx, C extends ConversationRef, E extends StoredEntry> = {
  store: ConversationStore<Tx, C, E>;
  transaction: <T>(run: (tx: Tx) => Promise<T>) => Promise<T>;
  caseHeader: string;
  caseOf: (assistant: string, conversation: string, step: number) => string;
  steps: number;
  stopped: (steps: number) => string;
  model: BaseChatModel;
  /** The input budget each model call is fitted to (D35). */
  budget: number;
};

/**
 * The run's context: the person, the conversation as the caller holds it (spec 3.4), and
 * what the run knows of that conversation's entries and window (D36).
 */
export type RunContext<C extends ConversationRef> = {
  person: string;
  conversation: C;
  ledger: Ledger;
};

/**
 * The context schema, built per agent: the conversation passes through as the caller's own
 * value, since the module reads only its id and hands it back to the store untouched.
 */
export const contextSchemaFor = <C extends ConversationRef>() =>
  z.object({ person: z.string(), conversation: z.custom<C>(), ledger: z.custom<Ledger>() });

/** The step middleware's own state: the step count, and the step's results by call id. */
const stepState = z.object({
  step: z.number().default(0),
  results: z.record(z.string(), z.custom<ToolMessage>()).default({}),
});

export const stepMiddleware = <Tx, C extends ConversationRef, E extends StoredEntry>(
  definition: AssistantDefinition<Tx>,
  wiring: Wiring<Tx, C, E>,
  contextSchema: ReturnType<typeof contextSchemaFor<C>>,
) => {
  /** The case a step is asked as, `<assistant>.message:<conversation id>#<n>` by default. */
  const caseOf = (context: RunContext<C>, n: number): string =>
    wiring.caseOf(definition.name, context.conversation.id, n);

  return createMiddleware({
    name: "step",
    stateSchema: stepState,
    contextSchema,
    beforeModel: {
      canJumpTo: ["end"],
      hook: async (state, runtime) => {
        const context = runtime.context as RunContext<C>;
        const say = (ran: Ran<E>) => runtime.writer?.(ran);
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
                `The step ${caseOf(context, state.step)} has no result for the call ${message.tool_call_id}`,
              );
            }
          }
        }
        const n = state.step + 1;
        if (n > wiring.steps) {
          const last = await wiring.transaction((tx) =>
            wiring.store.append(tx, context.conversation, "assistant", [
              { kind: "text", text: wiring.stopped(wiring.steps) },
            ]),
          );
          say({ kind: "entry", entry: last });
          return { jumpTo: "end" };
        }
        say({ kind: "activity", text: definition.stepPhrase(n) });
        return { step: n, results: {} };
      },
    },
    wrapModelCall: async (request, handler) => {
      const context = request.runtime.context as RunContext<C>;
      const caseHeader = { [wiring.caseHeader]: caseOf(context, request.state.step) };
      // The streamed path forwards a top-level `headers`, the unstreamed one
      // `options.headers` (D26, `ID282`); neither is in the call options' type.
      const modelSettings: unknown = { headers: caseHeader, options: { headers: caseHeader } };
      // The system prompt and the tools, then the history as it was appended (D33):
      // nothing volatile sits ahead of it. The history is fitted to the budget (D36).
      const messages = await fitted(request.messages.map(unnamed), {
        budget: wiring.budget,
        model: wiring.model,
        system: request.systemMessage,
        tools: request.tools,
        describe: definition.describe,
        ledger: context.ledger,
        save: (window) =>
          wiring.transaction((tx) => wiring.store.setWindow(tx, context.conversation, window)),
        named: caseOf(context, request.state.step),
      });
      return handler({
        ...request,
        messages,
        modelSettings: modelSettings as Record<string, unknown>,
      });
    },
    afterModel: async (state, runtime) => {
      const context = runtime.context as RunContext<C>;
      const say = (ran: Ran<E>) => runtime.writer?.(ran);
      const message = state.messages.at(-1);
      if (message === undefined || !AIMessage.isInstance(message)) {
        throw new Error("the step ended on a message that is not the model's");
      }
      const calls = callsOf(message, caseOf(context, state.step));
      const text = typeof message.content === "string" ? message.content : "";

      if (calls.length === 0) {
        const reply = await wiring.transaction((tx) =>
          wiring.store.append(tx, context.conversation, "assistant", [{ kind: "text", text }]),
        );
        context.ledger.entries.push(reply);
        say({ kind: "entry", entry: reply });
        return;
      }

      const summaries = calls.map((call) => summaryOf(definition, call));
      for (const summary of summaries) {
        if (summary !== null) say({ kind: "activity", text: summary });
      }

      const { written, parts } = await wiring.transaction(async (tx) => {
        const parts: Extract<AgentPart, { kind: "tool_result" }>[] = [];
        for (const call of calls) parts.push(await resultOf(tx, definition, context.person, call));
        const asked = await wiring.store.append(tx, context.conversation, "assistant", [
          ...(text === "" ? [] : [{ kind: "text" as const, text }]),
          ...calls.map((call) => ({
            kind: "tool_use" as const,
            id: call.id,
            name: call.name,
            input: call.args,
            arguments: call.written,
          })),
        ]);
        const answered = await wiring.store.append(tx, context.conversation, "tool", parts);
        return { written: [asked, answered], parts };
      });
      context.ledger.entries.push(...written);
      for (const entry of written) say({ kind: "entry", entry });

      return {
        results: Object.fromEntries(
          calls.map((call, at) => [
            call.id,
            resultMessage(parts[at] as Extract<AgentPart, { kind: "tool_result" }>),
          ]),
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
};
