import { randomUUID } from "node:crypto";
import { user } from "@app/db";
import { ChatOpenAICompletions } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type AssistantDefinition,
  type ContextConfig,
  ConversationAgent,
} from "../../../src/lib/agent";
import type { Conversation, Entry, Transaction } from "../../../src/lib/conversation";
import {
  agentOn,
  append,
  contextWindow,
  conversationStore,
  entries,
  open,
  transaction,
} from "../../support/agent";
import { chatModelThroughTheApp, forgetRequests, requestsSent, withCases } from "../../support/ai";
import { testDb } from "../../support/database";

/**
 * Seam C: `lib/agent`, the context budget (SL9, D35, D36, `ID304`).
 *
 * Behind it: PGlite with the real migrations, and the application's own mock, answered in
 * process. The agent is built from options, with a budget of a few hundred tokens, so a
 * short history drives every case. The definition is this file's own: a one-word prompt
 * and one tool, so what a request weighs is the history it carries.
 *
 * What is read: what `run` yields and throws, the conversation and its window through the
 * store, and the requests the model was sent. No table is read.
 */

afterEach(() => {
  forgetRequests();
  vi.restoreAllMocks();
});

/** The one tool: it reads a note, whose words the case gives it. */
const looking = {
  name: "look",
  description: "Looks.",
  input: z.object({}),
  run: async () => ({ read: "seen" }),
  summarise: () => "Looking",
};

const definition: AssistantDefinition<Transaction> = {
  name: "budget",
  prompt: "Test.",
  tools: [looking],
  stepPhrase: () => "Thinking",
  describe: () => null,
};

/** A person, and their conversation with this file's assistant, whose entry 1 says hello. */
const aConversation = async (): Promise<{ person: string; conversation: Conversation }> => {
  const person = randomUUID();
  await testDb.insert(user).values({ id: person, name: "Someone", email: `${person}@example.com` });
  const conversation = await open({ id: person } as never, "budget", null, async () => [
    { kind: "text", text: "Hello.", scripted: true },
  ]);
  return { person, conversation };
};

/** The person says something. */
const says = (conversation: Conversation, text: string): Promise<Entry> =>
  transaction((tx) => append(tx, conversation, "person", [{ kind: "text", text }]));

/** One step of the agent's, already taken: a call of `look`, and what it read. */
const looked = async (conversation: Conversation, id: string, read: string) =>
  transaction(async (tx) => {
    const call = await append(tx, conversation, "assistant", [
      { kind: "tool_use", id, name: "look", input: {}, arguments: "{}" },
    ]);
    const result = await append(tx, conversation, "tool", [
      { kind: "tool_result", id, name: "look", read },
    ]);
    return { id, call, result };
  });

/** A turn: the person's words, then as many steps as `reads` has, each reading its note. */
const turn = async (conversation: Conversation, text: string, reads: string[]) => {
  const said = await says(conversation, text);
  const steps = [];
  for (const [at, read] of reads.entries()) {
    steps.push(await looked(conversation, `call_${text.replace(/\W/g, "")}_${at}`, read));
  }
  return { said, steps };
};

/** A note of `tokens` tokens, as the library's counter weighs one: four characters each. */
const note = (tokens: number, letter = "x") => letter.repeat(4 * tokens);

type Sent = {
  messages: {
    role: string;
    content?: unknown;
    tool_calls?: { id: string }[];
    tool_call_id?: string;
  }[];
};

/** The history a request carried: its messages after the system prompt. */
const messagesOf = (at: number) => {
  const sent = requestsSent()[at];
  if (sent === undefined) throw new Error(`no request was sent at ${at}`);
  const [system, ...history] = (sent.body as Sent).messages;
  expect(system).toEqual({ role: "system", content: "Test." });
  return history;
};

/** The step's case, as the agent names it by default. */
const stepOf = (conversation: Conversation, n: number) => `budget.message:${conversation.id}#${n}`;

/** The agent with the given window, on this suite's database and model. */
const budgeted = (context: ContextConfig) => agentOn({ context });

/** Runs the agent to its end, answering step 1 with a reply unless the test gives cases. */
const ran = async (
  agent: ConversationAgent<Transaction, Conversation, Entry>,
  at: { person: string; conversation: Conversation },
  cases: Parameters<typeof withCases>[0] = {
    [stepOf(at.conversation, 1)]: { content: "Noted." },
  },
) => {
  const given = withCases(cases);
  try {
    const said: unknown[] = [];
    for await (const each of agent.run(definition, at.conversation, at.person)) said.push(each);
    return { said, thrown: undefined as unknown };
  } catch (thrown) {
    return { said: [], thrown };
  } finally {
    given.dispose();
  }
};

/** No tool result in the request is sent without the call it answers ahead of it. */
const pairedIn = (messages: Sent["messages"]) =>
  messages.every(
    (message, at) =>
      message.role !== "tool" ||
      messages
        .slice(0, at)
        .some((earlier) => earlier.tool_calls?.some((call) => call.id === message.tool_call_id)),
  );

describe("the window the agent is built with (D35)", () => {
  it("uses the binding's context: a model with no profile is built and held to it", async () => {
    const at = await aConversation();
    // 40 tokens of budget cannot hold even the prompt and the tool: the context is used.
    const tiny = agentOn({ context: { maxInputTokens: 1040, maxOutputTokens: 1000 } });
    await says(at.conversation, "Hi.");

    const { thrown } = await ran(tiny, at);

    expect(thrown).toMatchObject({ name: "ContextOverflowError" });
  });

  it("uses the model's own profile when the binding names no context", async () => {
    const profiled = chatModelThroughTheApp();
    vi.spyOn(profiled, "profile", "get").mockReturnValue({
      maxInputTokens: 1040,
      maxOutputTokens: 1000,
    });
    const at = await aConversation();
    const agent = new ConversationAgent({
      model: profiled,
      store: conversationStore,
      transaction,
    });
    await says(at.conversation, "Hi.");

    const { thrown } = await ran(agent, at, {
      [`budget.message:${at.conversation.id}#1`]: { content: "Noted." },
    });

    expect(thrown).toMatchObject({ name: "ContextOverflowError" });
  });

  it("is not built with neither, and says which model and which option", () => {
    const model = new ChatOpenAICompletions({
      model: "a-model-without-a-profile",
      apiKey: "never-sent",
    });

    expect(() => new ConversationAgent({ model, store: conversationStore, transaction })).toThrow(
      /a-model-without-a-profile.*`context`/,
    );
  });
});

describe("below 60% of the budget (D36)", () => {
  it("sends what an agent without a budget worth mentioning sends, and stores no window", async () => {
    const small = await aConversation();
    const large = await aConversation();
    for (const at of [small, large]) {
      await turn(at.conversation, "First.", [note(20), note(20)]);
      await says(at.conversation, "Second.");
    }

    await ran(budgeted({ maxInputTokens: 1000 }), small);
    await ran(budgeted({ maxInputTokens: 1_000_000 }), large);

    expect(messagesOf(0)).toEqual(messagesOf(1));
    expect(messagesOf(0)).toHaveLength(7);
    expect(await contextWindow(small.conversation)).toEqual({});
  });
});

describe("a cut event (D36)", () => {
  it("clears the tool results older than the three newest, keeps their calls, and stops there when that is enough", async () => {
    const at = await aConversation();
    const old = await turn(at.conversation, "Look a lot.", [
      note(150, "a"),
      note(150, "b"),
      note(150, "c"),
    ]);
    const recent = await turn(at.conversation, "And a little.", [
      note(10, "d"),
      note(10, "e"),
      note(10, "f"),
    ]);
    await says(at.conversation, "Well?");

    await ran(budgeted({ maxInputTokens: 800 }), at);

    const sent = messagesOf(0);
    const results = sent.filter((message) => message.role === "tool");
    expect(results.map((message) => message.content)).toEqual([
      "[cleared]",
      "[cleared]",
      "[cleared]",
      JSON.stringify(note(10, "d")),
      JSON.stringify(note(10, "e")),
      JSON.stringify(note(10, "f")),
    ]);
    expect(sent.filter((message) => message.tool_calls !== undefined)).toHaveLength(6);
    expect(sent[0]).toEqual({ role: "assistant", content: "Hello." });
    const lastOld = old.steps.at(-1)?.result.position ?? 0;
    expect(await contextWindow(at.conversation)).toEqual({ cleared: lastOld + 1 });
    expect(recent.steps[0]?.result.position).toBe(lastOld + 2 + 1);
  });

  it("drops the oldest turns down to 30% when clearing is not enough, never parting a call from its result", async () => {
    const at = await aConversation();
    await turn(at.conversation, "First.", [note(100), note(100)]);
    await turn(at.conversation, "Second.", [note(100), note(100)]);
    const third = await turn(at.conversation, "Third.", [note(100), note(100)]);
    await says(at.conversation, "Now?");

    await ran(budgeted({ maxInputTokens: 1000 }), at);

    const sent = messagesOf(0);
    expect(sent[0]).toEqual({ role: "user", content: "Third." });
    expect(sent.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "user",
    ]);
    expect(pairedIn(sent)).toBe(true);
    const window = await contextWindow(at.conversation);
    expect(window.cut).toBe(third.said.position);
    expect(window.cleared).toBeLessThanOrEqual(third.said.position);
    // The history stays in the store: a cut only changes what is sent.
    expect((await entries(at.conversation)).length).toBeGreaterThan(third.said.position);
  });

  it("applies the stored window to the next request, which shares the cut request's prefix", async () => {
    const at = await aConversation();
    await turn(at.conversation, "First.", [note(100), note(100)]);
    await turn(at.conversation, "Second.", [note(100), note(100)]);
    await turn(at.conversation, "Third.", [note(100), note(100)]);
    await says(at.conversation, "Now?");
    const agent = budgeted({ maxInputTokens: 1000 });
    await ran(agent, at);
    const cut = await contextWindow(at.conversation);

    await says(at.conversation, "And now?");
    await ran(agent, at);

    const [first, second] = [messagesOf(0), messagesOf(1)];
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.slice(first.length)).toEqual([
      { role: "assistant", content: "Noted." },
      { role: "user", content: "And now?" },
    ]);
    expect(await contextWindow(at.conversation)).toEqual(cut);
  });

  it("shares the prefix between the steps of one run, a call and its result appended", async () => {
    const at = await aConversation();
    await turn(at.conversation, "First.", [note(100), note(100)]);
    await turn(at.conversation, "Second.", [note(100), note(100)]);
    await turn(at.conversation, "Third.", [note(100), note(100)]);
    await says(at.conversation, "Now?");

    await ran(budgeted({ maxInputTokens: 1000 }), at, {
      [stepOf(at.conversation, 1)]: {
        content: "",
        tool_calls: [{ id: "call_in_run", name: "look", arguments: {} }],
      },
      [stepOf(at.conversation, 2)]: { content: "Seen." },
    });

    const [first, second] = [messagesOf(0), messagesOf(1)];
    expect(requestsSent()).toHaveLength(2);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.slice(first.length).map((message) => message.role)).toEqual([
      "assistant",
      "tool",
    ]);
  });

  it("cuts again only when the input reaches 60% again", async () => {
    const at = await aConversation();
    await turn(at.conversation, "First.", [note(100), note(100)]);
    await turn(at.conversation, "Second.", [note(100), note(100)]);
    await turn(at.conversation, "Third.", [note(100), note(100)]);
    await says(at.conversation, "Now?");
    const agent = budgeted({ maxInputTokens: 1000 });
    await ran(agent, at);
    const first = await contextWindow(at.conversation);

    await turn(at.conversation, "Fourth.", [note(20)]);
    await says(at.conversation, "Still there?");
    await ran(agent, at);
    expect(await contextWindow(at.conversation)).toEqual(first);

    await turn(at.conversation, "Fifth.", [note(120), note(120)]);
    const sixth = await says(at.conversation, "And now?");
    await ran(agent, at);
    const second = await contextWindow(at.conversation);
    expect(second.cut).toBeGreaterThan(first.cut ?? 0);
    expect(second.cut).toBeLessThanOrEqual(sixth.position);
    expect(messagesOf(2)[0]).toMatchObject({ role: "user" });
  });
});

describe("the floor: the turn in progress alone (D36)", () => {
  it("fails the call with a named error when it does not fit, and writes nothing", async () => {
    const at = await aConversation();
    await turn(at.conversation, "First.", [note(30)]);
    await says(at.conversation, note(400, "y"));
    const before = await entries(at.conversation);

    const { thrown } = await ran(budgeted({ maxInputTokens: 300 }), at);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: "ContextOverflowError" });
    expect((thrown as Error).message).toContain(stepOf(at.conversation, 1));
    expect(requestsSent()).toEqual([]);
    expect(await entries(at.conversation)).toEqual(before);
    expect(await contextWindow(at.conversation)).toEqual({});
  });
});
