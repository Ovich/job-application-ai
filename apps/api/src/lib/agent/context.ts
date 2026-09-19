import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  type BaseMessage,
  HumanMessage,
  type SystemMessage,
  ToolMessage,
  trimMessages,
} from "@langchain/core/messages";
import type { ClientTool, ServerTool } from "@langchain/core/tools";
import { ClearToolUsesEdit, countTokensApproximately } from "langchain";
import type { AssistantDefinition, ContextConfig, ContextWindow, StoredEntry } from "./index";
import { asMessages } from "./messages";

/**
 * The agent's context budget (D35, D36, `ID304`): how much the model takes, how big a
 * request is, and the cut event that brings a request back inside the budget.
 *
 * **The history is cut rarely and in one block.** A prompt cache matches the prefix, so a
 * window that slides with every call misses on every call. Below 60% of the budget
 * nothing changes; at or above it, one cut event decides a new window, which is stored on
 * the conversation and rebuilt the same way by every later request until the next event.
 *
 * **Everything here is the library's rule, used once.** `countTokensApproximately` counts;
 * `ClearToolUsesEdit` (the three newest results kept, calls left in place) decides which
 * tool results are cleared; `trimMessages` (newest kept, starting on a person's message)
 * decides which turns go. Neither is mounted as middleware: that would re-apply the edit
 * on every call and move its window with each new tool use.
 */

/** From this share of the budget on, a request triggers a cut event. */
const trigger = 0.6;

/** What a cut event brings a request down to, when clearing old results is not enough. */
const target = 0.3;

/** How many of the newest tool results a cut event keeps whole. */
const keep = 3;

/** The model as a person configured it: its own name where it has one. */
const nameOf = (model: BaseChatModel): string =>
  "model" in model && typeof model.model === "string" ? model.model : model.getName();

/** The model's input budget: what it accepts, less the reply's reserve (D35). */
export const budgetOf = (model: BaseChatModel, context: ContextConfig | undefined): number => {
  const limits = context ?? model.profile;
  if (limits.maxInputTokens === undefined) {
    throw new Error(
      `The model ${nameOf(model)} has no profile that says how much context it takes: pass the agent's \`context\` option ({ maxInputTokens, maxOutputTokens })`,
    );
  }
  return limits.maxInputTokens - (limits.maxOutputTokens ?? 0);
};

/** The turn in progress does not fit the budget on its own: nothing is cut past it. */
export class ContextOverflowError extends Error {
  override name = "ContextOverflowError";
}

/**
 * What a run knows of its conversation: the entries read before the first step, the
 * entries its steps committed since, and the stored window. The step middleware keeps it
 * current; a cut event writes its window here as well as to the store.
 */
export type Ledger = { entries: StoredEntry[]; window: ContextWindow };

type Tools = (ClientTool | ServerTool)[];

/** A message and the position of the entry it was built from. */
type Placed = { position: number; message: BaseMessage };

/** The library's edit, triggered where a cut event is: the three newest results kept, calls left. */
const clearing = (budget: number) =>
  new ClearToolUsesEdit({
    trigger: { tokens: Math.max(1, Math.floor(trigger * budget)) },
    keep: { messages: keep },
  });

/** What a cleared tool result says instead: the library's own placeholder. */
const placeholder = new ClearToolUsesEdit().placeholder;

/** The entries as the model reads them, each message tagged with its entry's position. */
const placed = (entries: readonly StoredEntry[], describe: Describe): Placed[] =>
  entries.flatMap((entry) =>
    asMessages([entry], describe).map((message) => ({ position: entry.position, message })),
  );

type Describe = AssistantDefinition<never>["describe"];

/** The history with a window applied: entries from `cut` on, old tool results as the placeholder. */
const windowed = (history: readonly Placed[], window: ContextWindow): Placed[] => {
  return history
    .filter(({ position }) => window.cut === undefined || position >= window.cut)
    .map((each) =>
      window.cleared !== undefined &&
      each.position < window.cleared &&
      ToolMessage.isInstance(each.message)
        ? {
            position: each.position,
            message: new ToolMessage({
              tool_call_id: each.message.tool_call_id,
              ...(each.message.name === undefined ? {} : { name: each.message.name }),
              content: placeholder,
            }),
          }
        : each,
    );
};

/** What the request fits in, and how it is measured. */
export type Fitting = {
  budget: number;
  model: BaseChatModel;
  system: SystemMessage;
  tools: Tools;
  describe: Describe;
  ledger: Ledger;
  /** Stores a new window in the agent's transaction; resolves once it committed. */
  save: (window: ContextWindow) => Promise<void>;
  /** The step's case, for the error's words. */
  named: string;
};

/**
 * The messages a model call sends (D36). A conversation without a window whose request is
 * below the trigger sends `messages` as they are, byte for byte what it sent before the
 * budget existed. Otherwise the history is rebuilt from the entries with the window
 * applied, and a request at or above the trigger is one cut event.
 */
export const fitted = async (messages: BaseMessage[], fitting: Fitting): Promise<BaseMessage[]> => {
  const count = (sent: readonly BaseMessage[]) =>
    countTokensApproximately([fitting.system, ...sent], fitting.tools);
  const stored = fitting.ledger.window;
  const unwindowed = stored.cut === undefined && stored.cleared === undefined;
  if (unwindowed && count(messages) < trigger * fitting.budget) return messages;

  const history = placed(fitting.ledger.entries, fitting.describe);
  const sent = windowed(history, stored).map(({ message }) => message);
  if (count(sent) < trigger * fitting.budget) return sent;

  const window = await cutEvent(history, stored, fitting, count);
  const cut = windowed(history, window).map(({ message }) => message);
  if (count(cut) > fitting.budget) {
    throw new ContextOverflowError(
      `The AI call about ${fitting.named} failed: the message in progress does not fit the model's context budget of ${fitting.budget} tokens`,
    );
  }
  await fitting.save(window);
  fitting.ledger.window = window;
  return cut;
};

/**
 * One cut event: the tool results `ClearToolUsesEdit` clears, then, if the request is
 * still above the target, the turns `trimMessages` drops. Positions only move forward.
 */
const cutEvent = async (
  history: readonly Placed[],
  stored: ContextWindow,
  fitting: Fitting,
  count: (sent: readonly BaseMessage[]) => number,
): Promise<ContextWindow> => {
  const current = windowed(history, stored);
  const cleared = await clearedFrom(current, stored, fitting, count);
  const afterClearing: ContextWindow = {
    ...(stored.cut === undefined ? {} : { cut: stored.cut }),
    ...(cleared === undefined ? {} : { cleared }),
  };
  const remaining = windowed(history, afterClearing);
  if (count(remaining.map(({ message }) => message)) <= target * fitting.budget) {
    return afterClearing;
  }
  const cut = await cutFrom(remaining, fitting, count);
  return { ...afterClearing, ...(cut === undefined ? {} : { cut }) };
};

/**
 * Where clearing stops: past the last entry whose results the edit cleared, or at it
 * when the edit kept one of its results, so the three newest are always whole.
 */
const clearedFrom = async (
  current: readonly Placed[],
  stored: ContextWindow,
  fitting: Fitting,
  count: (sent: readonly BaseMessage[]) => number,
): Promise<number | undefined> => {
  const edited = current.map(({ message }) => message);
  await clearing(fitting.budget).apply({
    messages: edited,
    model: fitting.model,
    countTokens: count,
  });
  const clearedIds = new Set(
    edited.flatMap((message) =>
      ToolMessage.isInstance(message) &&
      (message.response_metadata["context_editing"] as { cleared?: boolean } | undefined)?.cleared
        ? [message.tool_call_id]
        : [],
    ),
  );
  const results = current.flatMap(({ position, message }) =>
    ToolMessage.isInstance(message)
      ? [{ position, cleared: clearedIds.has(message.tool_call_id) }]
      : [],
  );
  const last = results.findLast((result) => result.cleared);
  if (last === undefined) return stored.cleared;
  const whole = results
    .filter((result) => result.position === last.position)
    .every((result) => result.cleared);
  const cleared = whole ? last.position + 1 : last.position;
  return Math.max(cleared, stored.cleared ?? cleared);
};

/**
 * Where the history starts after the event: the newest turns that fit the target,
 * starting on a person's message so no tool result is parted from its call. When not even
 * the turn in progress fits the target, the cut is at that turn, and the caller measures
 * it against the whole budget.
 */
const cutFrom = async (
  remaining: readonly Placed[],
  fitting: Fitting,
  count: (sent: readonly BaseMessage[]) => number,
): Promise<number | undefined> => {
  const messages = remaining.map(({ message }) => message);
  const kept = await trimMessages(messages, {
    maxTokens: Math.floor(target * fitting.budget),
    tokenCounter: (sent) => count(sent),
    strategy: "last",
    startOn: "human",
  });
  if (kept.length > 0) return remaining[remaining.length - kept.length]?.position;
  return remaining.findLast(({ message }) => HumanMessage.isInstance(message))?.position;
};
