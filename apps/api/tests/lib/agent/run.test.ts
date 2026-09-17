import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { itemExperience, itemLine, profileItem, user } from "@app/db";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { profileAssistant } from "../../../src/assistants/profile";
import { ConversationAgent } from "../../../src/lib/agent";
import type { Conversation, Entry } from "../../../src/lib/conversation";
import { apply, profileEditTool, profileReadTool } from "../../../src/lib/profile-edit";
import {
  agentOn,
  append,
  conversationStore,
  entries,
  open,
  transaction,
} from "../../support/agent";
import {
  chatModelThroughTheApp,
  failingMidStream,
  forgetRequests,
  requestsAnswered,
  requestsSent,
  withCases,
} from "../../support/ai";
import { testDb } from "../../support/database";
import { failingOn } from "../../support/failing-entry";

/**
 * Seam C: `lib/agent`, `ConversationAgent.run` (`S4.4`, `S4.5`, `ID179`, `ID180`, `ID182`,
 * `ID187`, `ID193`, `ID298`, `US2`, `US6`, the spec's *Failure modes*).
 *
 * Behind it: PGlite with the real migrations, and the application's own mock, answered in
 * process, with recorded cases per step (`ID182`). The module imports neither since the
 * rework, so nothing is stood in: the agent is built from options, as the composition root
 * builds it, and `tests/support/agent.ts` is that binding for the suite. The definition is
 * the profile assistant as the composition root hands it over.
 *
 * What is read: what `run` yields, the conversation through the store, the item through
 * `lib/profile-edit`'s `apply` with no operation, and the requests the model sent. No
 * table is read. Whether a transaction is open while the model is asked is held by the
 * code's shape and the review, not asserted here.
 */

/** The agent as `app.ts` builds it, on this suite's database and model. */
const agent = agentOn();

afterEach(() => {
  forgetRequests();
  vi.restoreAllMocks();
});

type Planted = { person: string; post: string; lines: [string, string, string] };

/** A person whose profile holds one post of three lines. */
const planted = async (): Promise<Planted> => {
  const person = randomUUID();
  await testDb.insert(user).values({ id: person, name: "Someone", email: `${person}@example.com` });
  const post = randomUUID();
  await testDb.insert(profileItem).values({
    id: post,
    userId: person,
    kind: "experience",
    title: "Platform engineer",
    position: 0,
  });
  await testDb.insert(itemExperience).values({ itemId: post, organisation: "Nexplore" });
  const lines: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  const texts = [
    "Ran the services on Kubernetes.",
    "Designed and shipped the internal developer platform used by every team in the company.",
    "Wrote the on-call runbooks.",
  ];
  for (const [at, id] of lines.entries()) {
    await testDb.insert(itemLine).values({ id, itemId: post, text: texts[at] ?? "", position: at });
  }
  return { person, post, lines };
};

/** The person's conversation, its opening, and the person's message after it. */
const conversationOf = async (person: string): Promise<Conversation> => {
  const conversation = await open({ id: person } as never, "profile", null, async () => [
    { kind: "text", text: "I read your 1 document.", scripted: true },
  ]);
  await testDb.transaction((tx) =>
    append(tx, conversation, "person", [
      { kind: "text", text: "Shorten the second line of my Nexplore post." },
    ]),
  );
  return conversation;
};

type Ran =
  | { kind: "activity"; text: string }
  | { kind: "text"; text: string }
  | { kind: "entry"; entry: Entry };

/** Everything `run` yielded, and what it threw, if it threw. */
const ranThrough = async (
  iterable: AsyncIterable<Ran>,
): Promise<{ said: Ran[]; thrown: unknown }> => {
  const said: Ran[] = [];
  try {
    for await (const ran of iterable) said.push(ran);
    return { said, thrown: undefined };
  } catch (thrown) {
    return { said, thrown };
  }
};

const textOf = (said: Ran[]) =>
  said.flatMap((ran) => (ran.kind === "text" ? [ran.text] : [])).join("");

const entriesOf = (said: Ran[]) => said.flatMap((ran) => (ran.kind === "entry" ? [ran.entry] : []));

/** The item as it stands, read through `apply` with no operation. */
const standing = async (person: string, itemId: string) => {
  const read = await testDb.transaction((tx) => apply(tx, person, itemId, []));
  if ("refused" in read) throw new Error(read.refused);
  return read.after;
};

const stepOf = (conversation: Conversation, n: number) => `profile.message:${conversation.id}#${n}`;

type Sent = {
  messages: { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }[];
  tools: { type: string; function: { name: string; description: string; parameters: object } }[];
};

const bodyOf = (at: number) => requestsSent()[at]?.body as Sent;

describe("on the mock, every step misses (US2, dev)", () => {
  it("runs one step, answers No pre generated text, writes one entry, and changes nothing", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const before = await standing(at.person, at.post);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { said, thrown } = await ranThrough(agent.run(profileAssistant, conversation, at.person));

    expect(thrown).toBeUndefined();
    expect(textOf(said)).toBe("No pre generated text");
    expect(entriesOf(said).map((entry) => [entry.author, entry.parts])).toEqual([
      ["assistant", [{ kind: "text", text: "No pre generated text" }]],
    ]);
    expect(requestsSent()).toHaveLength(1);
    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBe(stepOf(conversation, 1));
    expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
    ]);
    expect(await standing(at.person, at.post)).toEqual(before);
  });
});

describe("recorded answers of two steps (S4.5)", () => {
  it("changes the item in step 1, replies in step 2, and writes each step's entries as they commit", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const before = await standing(at.person, at.post);
    const input = {
      itemId: at.post,
      operations: [
        { op: "replace_line", lineId: at.lines[1], text: "Shipped the developer platform." },
      ],
    };
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "the model shortens the line",
        content: "I will shorten the second line.",
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: input }],
      },
      [stepOf(conversation, 2)]: {
        stands_for: "the model says it did",
        content: "Done: the second line now reads Shipped the developer platform.",
      },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    // What the agent is doing comes before each step's words and before its call (S7.5).
    expect(ran.said.map((each) => each.kind).filter((kind, i, all) => all[i - 1] !== kind)).toEqual(
      ["activity", "text", "activity", "entry", "activity", "text", "entry"],
    );

    const after = await standing(at.person, at.post);
    expect(after.lines[1]).toEqual({ id: at.lines[1], text: "Shipped the developer platform." });

    const stored = await entries(conversation);
    expect(stored.map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(stored[2]?.parts).toEqual([
      { kind: "text", text: "I will shorten the second line." },
      // The parsed input, and the arguments string as the model sent it (ID206).
      {
        kind: "tool_use",
        id: "call_1",
        name: "edit_profile",
        input,
        arguments: JSON.stringify(input),
      },
    ]);
    expect(stored[3]?.parts).toEqual([
      { kind: "tool_result", id: "call_1", name: "edit_profile", before, after },
    ]);
    expect(stored[4]?.parts).toEqual([
      { kind: "text", text: "Done: the second line now reads Shipped the developer platform." },
    ]);
    // Each entry was yielded once it had committed: what was yielded is what is stored.
    expect(entriesOf(ran.said)).toEqual(stored.slice(2));

    // Step 2 is handed the model's own message back, and the tool's answer to it (S4.3);
    // no profile is sent ahead of the history (D33). The call's arguments and the
    // tool's answer are compared as JSON values: the entry's parts are a `jsonb` column,
    // which keeps every value and not the order of an object's keys.
    expect(requestsSent()).toHaveLength(2);
    expect(requestsSent()[1]?.headers["x-jobapp-case"]).toBe(stepOf(conversation, 2));
    const asked = bodyOf(1).messages.find((message) => message.tool_calls !== undefined) as
      | {
          role: string;
          content: unknown;
          tool_calls: { id: string; type: string; function: { name: string; arguments: string } }[];
        }
      | undefined;
    expect(Object.keys(asked ?? {}).sort()).toEqual(["content", "role", "tool_calls"]);
    expect(asked?.role).toBe("assistant");
    expect(asked?.content).toBe("I will shorten the second line.");
    expect(
      asked?.tool_calls.map((call) => ({
        ...call,
        function: { ...call.function, arguments: JSON.parse(call.function.arguments) },
      })),
    ).toEqual([
      { id: "call_1", type: "function", function: { name: "edit_profile", arguments: input } },
    ]);
    const answered = bodyOf(1).messages.find((message) => message.role === "tool");
    expect(answered?.tool_call_id).toBe("call_1");
    expect(JSON.parse(String(answered?.content))).toEqual({ before, after });
    expect(bodyOf(1).messages.slice(0, bodyOf(0).messages.length)).toEqual(bodyOf(0).messages);
  });
});

/**
 * What the agent is doing, as a short phrase (`S7.5`, `ID210`, spec `H27`): the step's own
 * before its first words, and the called tool's summary of the call before it is applied.
 * Never stored: the conversation holds only what it held before.
 */
describe("what the agent says it is doing (S7.5, ID210)", () => {
  const activitiesOf = (said: Ran[]) =>
    said.flatMap((ran) => (ran.kind === "activity" ? [ran.text] : []));

  it("yields the step's phrase before its first words, and stores none of it", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { said } = await ranThrough(agent.run(profileAssistant, conversation, at.person));

    expect(said[0]).toEqual({ kind: "activity", text: "Thinking about your message" });
    expect(said.findIndex((ran) => ran.kind === "activity")).toBeLessThan(
      said.findIndex((ran) => ran.kind === "text"),
    );
    expect(JSON.stringify(await entries(conversation))).not.toContain(
      "Thinking about your message",
    );
  });

  it("yields profileEditTool's summary of the call after the step's words and before its entries", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "the model shortens the line",
        content: "I will shorten the second line.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [{ op: "replace_line", lineId: at.lines[1], text: "Shipped it." }],
            },
          },
        ],
      },
      [stepOf(conversation, 2)]: { stands_for: "the reply", content: "Done." },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    const summary = ran.said.findIndex(
      (each) => each.kind === "activity" && each.text === "Rewriting a line",
    );
    expect(summary).toBeGreaterThan(ran.said.findIndex((each) => each.kind === "text"));
    expect(summary).toBeLessThan(ran.said.findIndex((each) => each.kind === "entry"));
    expect(activitiesOf(ran.said)).toEqual([
      "Thinking about your message",
      "Rewriting a line",
      "Thinking it through",
    ]);
    expect(JSON.stringify(await entries(conversation))).not.toContain("Rewriting a line");
  });
});

describe("an edit that does not validate (the spec's Failure modes)", () => {
  /**
   * A person's post, and a conversation whose step 1 makes the call `call` builds for
   * that post and whose step 2 replies. Hands back the post as it stood before the run,
   * and the conversation as it stands after.
   */
  const refusedIn = async (call: (at: Planted) => { name: string; arguments: unknown }) => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const before = await standing(at.person, at.post);
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "the model asks for an edit that cannot be done",
        content: "I will change it.",
        tool_calls: [{ id: "call_1", ...call(at) }],
      },
      [stepOf(conversation, 2)]: {
        stands_for: "the model says it could not",
        content: "I could not change it.",
      },
    });
    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }
    expect(ran.thrown).toBeUndefined();
    return { at, conversation, before, stored: await entries(conversation) };
  };

  it("leaves the item unchanged, records the refusal, and gives it back to the model in step 2", async () => {
    const { at, conversation, before, stored } = await refusedIn(() => ({
      name: "edit_profile",
      arguments: {
        itemId: "an-item-nobody-has",
        operations: [{ op: "set", field: "title", value: "Never applied" }],
      },
    }));

    expect(stored.map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(stored[3]?.parts).toEqual([
      {
        kind: "tool_result",
        id: "call_1",
        name: "edit_profile",
        refused: expect.stringContaining("an-item-nobody-has"),
      },
    ]);
    expect(await standing(at.person, at.post)).toEqual(before);
    expect(requestsSent()[1]?.headers["x-jobapp-case"]).toBe(stepOf(conversation, 2));
    const answered = bodyOf(1).messages.find((message) => message.role === "tool");
    expect(answered?.tool_call_id).toBe("call_1");
    expect(JSON.parse(String(answered?.content))).toEqual({
      refused: expect.stringContaining("an-item-nobody-has"),
    });
  });

  it("refuses a line that no longer exists, and applies nothing of the edit", async () => {
    const { at, before, stored } = await refusedIn((planting) => ({
      name: "edit_profile",
      arguments: {
        itemId: planting.post,
        operations: [
          { op: "set", field: "title", value: "Never applied" },
          { op: "replace_line", lineId: "a-line-gone-since", text: "Never applied." },
        ],
      },
    }));

    expect(stored[3]?.parts).toEqual([
      {
        kind: "tool_result",
        id: "call_1",
        name: "edit_profile",
        refused: expect.stringContaining("a-line-gone-since"),
      },
    ]);
    expect(await standing(at.person, at.post)).toEqual(before);
  });

  it("refuses arguments that do not fit the tool's input", async () => {
    const { at, before, stored } = await refusedIn((planting) => ({
      name: "edit_profile",
      arguments: { itemId: planting.post, operations: [] },
    }));

    expect(stored[3]?.parts).toEqual([
      { kind: "tool_result", id: "call_1", name: "edit_profile", refused: expect.any(String) },
    ]);
    expect(await standing(at.person, at.post)).toEqual(before);
  });

  it("refuses a call to a tool the definition does not list", async () => {
    const { at, before, stored } = await refusedIn(() => ({
      name: "delete_account",
      arguments: {},
    }));

    expect(stored[3]?.parts).toEqual([
      {
        kind: "tool_result",
        id: "call_1",
        name: "delete_account",
        refused: expect.stringContaining("delete_account"),
      },
    ]);
    expect(await standing(at.person, at.post)).toEqual(before);
  });
});

describe("the step limit (ID180)", () => {
  it("is 5, stops after the fifth step that calls, says so, and never asks a sixth time", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const steps = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((n) => [
        stepOf(conversation, n),
        {
          stands_for: `step ${n} calls again`,
          content: `Step ${n}.`,
          tool_calls: [
            {
              id: `call_${n}`,
              name: "edit_profile",
              arguments: {
                itemId: at.post,
                operations: [{ op: "set", field: "title", value: `Title ${n}` }],
              },
            },
          ],
        },
      ]),
    );
    const cases = withCases(steps);

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(agent.steps).toBe(5);
    expect(ran.thrown).toBeUndefined();
    expect(requestsSent()).toHaveLength(5);
    const stored = await entries(conversation);
    expect(stored.map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      ...[1, 2, 3, 4, 5].flatMap(() => ["assistant", "tool"]),
      "assistant",
    ]);
    const last = stored.at(-1);
    expect(last?.parts).toEqual([{ kind: "text", text: expect.stringMatching(/stopped/i) }]);
    expect(entriesOf(ran.said).at(-1)).toEqual(last);
    // What the five steps committed stays.
    expect((await standing(at.person, at.post)).title).toBe("Title 5");
  });
});

describe("failures (US6, the spec's Failure modes)", () => {
  it("leaves neither the edit nor the entry when the step's entry cannot be written, and throws", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const before = await standing(at.person, at.post);
    const failure = await failingOn(testDb, "INJECTED-FAILURE-7");
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "an edit whose record cannot be written",
        content: "I will shorten it.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [{ op: "replace_line", lineId: at.lines[1], text: "INJECTED-FAILURE-7" }],
            },
          },
        ],
      },
      [stepOf(conversation, 2)]: { stands_for: "never asked", content: "Done." },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
      await failure.dispose();
    }

    expect(String(ran.thrown)).toMatch(/INJECTED-FAILURE-7/);
    expect(entriesOf(ran.said)).toEqual([]);
    expect(requestsSent()).toHaveLength(1);
    expect(await standing(at.person, at.post)).toEqual(before);
    expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
    ]);
  });

  it("keeps step 1, writes nothing of step 2, and throws when step 2's call fails mid-stream", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    // Step 2's request fails mid-stream, on an agent built on that model (D25, `ID274`).
    const failing = agentOn({ model: failingMidStream(chatModelThroughTheApp(), "#2") });
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "an edit",
        content: "I will shorten it.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [
                {
                  op: "replace_line",
                  lineId: at.lines[1],
                  text: "Shipped the developer platform.",
                },
              ],
            },
          },
        ],
      },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(failing.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(String(ran.thrown)).toMatch(/went away mid-stream/);
    expect(entriesOf(ran.said).map((entry) => entry.author)).toEqual(["assistant", "tool"]);
    expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
      "tool",
    ]);
    expect((await standing(at.person, at.post)).lines[1]?.text).toBe(
      "Shipped the developer platform.",
    );
  });

  /**
   * Arguments that are not JSON fail the message as the loop did (migration `O6`, spec
   * section 7, `ID283`): arguments that are not JSON at all, which the library files as
   * invalid, and arguments cut short, which it reads as partial JSON and hands on as a call.
   */
  it.each([
    ["not JSON at all", (post: string) => `{"itemId": ${post}}`],
    ["cut short", (post: string) => `{"itemId": "${post.slice(0, 8)}`],
  ])(
    "writes nothing of a step whose call's arguments are %s, and throws naming the case",
    async (_shape, botched) => {
      const at = await planted();
      const conversation = await conversationOf(at.person);
      const before = await standing(at.person, at.post);
      const cases = withCases({
        [stepOf(conversation, 1)]: {
          stands_for: "a call the model botched",
          content: "I will change it.",
          tool_calls: [{ id: "call_1", name: "edit_profile", arguments: botched(at.post) }],
        },
        [stepOf(conversation, 2)]: { stands_for: "never asked", content: "Done." },
      });

      let ran: { said: Ran[]; thrown: unknown };
      try {
        ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
      } finally {
        cases.dispose();
      }

      expect(String(ran.thrown)).toContain(stepOf(conversation, 1));
      expect(String(ran.thrown)).toMatch(/not JSON/);
      expect(entriesOf(ran.said)).toEqual([]);
      expect(requestsSent()).toHaveLength(1);
      expect(await standing(at.person, at.post)).toEqual(before);
      expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
        "assistant",
        "person",
      ]);
    },
  );
});

/**
 * The case header per model call (D22, D26, `ID282`): the graph streams, so the header
 * must reach the streamed request, and each call names its own step.
 */
describe("the case header (D22, D26)", () => {
  it("names each step on its own streamed model call", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "an edit",
        content: "I will change the title.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [{ op: "set", field: "title", value: "Staff engineer" }],
            },
          },
        ],
      },
      [stepOf(conversation, 2)]: { stands_for: "the reply", content: "Done." },
    });
    try {
      await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(requestsSent().map((sent) => sent.headers["x-jobapp-case"])).toEqual([
      stepOf(conversation, 1),
      stepOf(conversation, 2),
    ]);
    expect(requestsSent().map((sent) => (sent.body as { stream?: boolean }).stream)).toEqual([
      true,
      true,
    ]);
  });
});

/**
 * What the loop takes from the definition and knows nothing of itself (D10, D33): the
 * prompt, then the history with nothing between, and each step's phrase. A stand-in
 * definition, so nothing the profile assistant says can make these pass.
 */
describe("a definition's prompt and step phrases (D10, D33)", () => {
  it("sends its prompt then the history, nothing between, and yields its stepPhrase(n) for each step", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const standIn = {
      ...profileAssistant,
      prompt: "The stand-in's prompt.",
      stepPhrase: (n: number) => `Step ${n} of the stand-in`,
    };
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "an edit",
        content: "I will shorten it.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [{ op: "set", field: "title", value: "Senior platform engineer" }],
            },
          },
        ],
      },
      [stepOf(conversation, 2)]: { stands_for: "the reply", content: "Done." },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(standIn, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    expect(requestsSent()).toHaveLength(2);
    for (const index of requestsSent().keys()) {
      expect(bodyOf(index).messages.slice(0, 3)).toEqual([
        { role: "system", content: "The stand-in's prompt." },
        { role: "assistant", content: "I read your 1 document." },
        { role: "user", content: "Shorten the second line of my Nexplore post." },
      ]);
    }
    const steps = ran.said.flatMap((each) =>
      each.kind === "activity" && each.text.endsWith("of the stand-in") ? [each.text] : [],
    );
    expect(steps).toEqual(["Step 1 of the stand-in", "Step 2 of the stand-in"]);
    // A tool step still commits its call and its result together (4.3).
    expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
      "tool",
      "assistant",
    ]);
  });
});

describe("every request (S4.4, ID181, ID193)", () => {
  it("carries the profile definition's system prompt, then the history, and the read and edit tools", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "an edit",
        content: "I will shorten it.",
        tool_calls: [
          {
            id: "call_1",
            name: "edit_profile",
            arguments: {
              itemId: at.post,
              operations: [{ op: "set", field: "title", value: "Senior platform engineer" }],
            },
          },
        ],
      },
      [stepOf(conversation, 2)]: { stands_for: "the reply", content: "Done." },
    });
    try {
      await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    const prompt = readFileSync(
      new URL("../../../src/assistants/profile/prompt.md", import.meta.url),
      "utf8",
    );
    expect(prompt.trim()).not.toBe("");
    expect(profileAssistant.prompt).toBe(prompt);
    expect(requestsSent()).toHaveLength(2);
    for (const index of requestsSent().keys()) {
      const { messages, tools } = bodyOf(index);
      expect(messages[0]).toEqual({ role: "system", content: prompt });
      expect(messages.slice(1).map((message) => message.role)).not.toContain("system");
      expect(messages[1]).toEqual({ role: "assistant", content: "I read your 1 document." });
      expect(tools).toEqual([
        {
          type: "function",
          function: {
            name: "read_profile",
            description: profileReadTool.description,
            parameters: toJsonSchema(profileReadTool.input),
          },
        },
        {
          type: "function",
          function: {
            name: "edit_profile",
            description: profileEditTool.description,
            parameters: toJsonSchema(profileEditTool.input),
          },
        },
      ]);
    }
  });

  it("derives the edit tool's schema from profileEditTool's input, held by its snapshot", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await ranThrough(agent.run(profileAssistant, conversation, at.person));

    // Vitest's own snapshot file, which the formatter leaves as the suite wrote it.
    const tool = bodyOf(0).tools.find((each) => each.function.name === "edit_profile");
    expect(tool?.function.parameters).toMatchSnapshot();
  });
});

/**
 * S4.5b, `ID206`, D23: the stored part keeps step 1's call exactly as the model wrote it,
 * and step 2 carries it parsed and written again, keys in the model's order and only the
 * whitespace gone, while the edit and the drawing read the parsed input.
 */
describe("the model's own arguments (S4.5b, ID206, D23)", () => {
  it("stores the arguments string step 1 received, gives step 2 its keys in the model's order, and edits from the parsed input", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const written = `{"operations": [{"text": "Shipped the developer platform.", "op": "replace_line", "lineId": "${at.lines[1]}"}],  "itemId": "${at.post}"}`;
    const cases = withCases({
      [stepOf(conversation, 1)]: {
        stands_for: "a call whose keys are not in alphabetical order",
        content: "I will shorten it.",
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: written }],
      },
      [stepOf(conversation, 2)]: { stands_for: "the reply", content: "Done." },
    });

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await ranThrough(agent.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    const asked = bodyOf(1).messages.find((message) => message.tool_calls !== undefined) as
      { tool_calls: { function: { arguments: string } }[] } | undefined;
    // The model's string parsed and written again (D23): the same value, the keys in the
    // model's order, only the whitespace gone.
    const sent = asked?.tool_calls[0]?.function.arguments ?? "";
    expect(JSON.parse(sent)).toEqual(JSON.parse(written));
    expect(Object.keys(JSON.parse(sent))).toEqual(["operations", "itemId"]);
    expect(sent).toBe(JSON.stringify(JSON.parse(written)));
    const [, , call] = await entries(conversation);
    expect(call?.parts[1]).toEqual({
      kind: "tool_use",
      id: "call_1",
      name: "edit_profile",
      input: JSON.parse(written),
      arguments: written,
    });
    expect((await standing(at.person, at.post)).lines[1]?.text).toBe(
      "Shipped the developer platform.",
    );
  });
});

/**
 * How many steps one message may take (`ID180`, OD6): an option now, defaulting to five,
 * read back off the instance, and the entry that says the agent stopped names the number
 * the instance was built with.
 */
describe("the steps an instance was built with (OD6)", () => {
  it("is 5 by default and is read back off the instance, and an option changes it", () => {
    expect(agentOn().steps).toBe(5);
    expect(agentOn({ steps: 2 }).steps).toBe(2);
  });

  it("stops at the option's step, says so in the option's own number, and asks no further", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const twoSteps = agentOn({ steps: 2 });
    const cases = withCases(
      Object.fromEntries(
        [1, 2, 3].map((n) => [
          stepOf(conversation, n),
          {
            stands_for: `step ${n} calls again`,
            content: `Step ${n}.`,
            tool_calls: [
              {
                id: `call_${n}`,
                name: "edit_profile",
                arguments: {
                  itemId: at.post,
                  operations: [{ op: "set", field: "title", value: `Title ${n}` }],
                },
              },
            ],
          },
        ]),
      ),
    );

    try {
      await ranThrough(twoSteps.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(requestsSent()).toHaveLength(2);
    expect((await entries(conversation)).at(-1)?.parts).toEqual([
      { kind: "text", text: expect.stringContaining("2 steps") },
    ]);
    expect((await standing(at.person, at.post)).title).toBe("Title 2");
  });
});

/**
 * The case a step is asked as, and the header it travels in (OD10, D22): the module's own
 * defaults name no product, and the binding's values are what reach the wire.
 */
describe("the case and its header, default and bound (OD10)", () => {
  it("names no product by default: x-agent-case, and <assistant>.message:<conversation>#<n>", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const plain = new ConversationAgent({
      model: chatModelThroughTheApp(),
      store: conversationStore,
      transaction,
    });

    await ranThrough(plain.run(profileAssistant, conversation, at.person));

    expect(requestsSent()[0]?.headers["x-agent-case"]).toBe(stepOf(conversation, 1));
    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBeUndefined();
  });

  it("asks each step as the binding words it, in the header the binding names", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const named = agentOn({
      caseOf: (assistant, of, step) => `${assistant}/${of}/${step}`,
    });
    const cases = withCases({
      [`profile/${conversation.id}/1`]: { stands_for: "the reply", content: "Done." },
    });

    try {
      await ranThrough(named.run(profileAssistant, conversation, at.person));
    } finally {
      cases.dispose();
    }

    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBe(`profile/${conversation.id}/1`);
  });
});

/**
 * The cache of built graphs is the instance's (`ID284`, OD1): a definition asked of two
 * agents is built twice, once per agent, so the second is never answered by the first's.
 */
describe("two agents share no built graph (OD1)", () => {
  it("asks the same definition through each instance's own wiring", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const one = agentOn();
    const other = agentOn({ caseHeader: "X-Other-Case" });

    await ranThrough(one.run(profileAssistant, conversation, at.person));
    await ranThrough(other.run(profileAssistant, conversation, at.person));

    expect(requestsSent()).toHaveLength(2);
    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBe(stepOf(conversation, 1));
    expect(requestsSent()[1]?.headers["x-jobapp-case"]).toBeUndefined();
    expect(requestsSent()[1]?.headers["x-other-case"]).toBe(stepOf(conversation, 1));
  });
});

/**
 * The profile read through the tool (D33, `ID301`), on a chain the mock plays (D37): the
 * shipped kind of answer, found by the person's message, whose call is `read_profile` and
 * whose `next` is the reply. The read runs for real; only the model's side is written.
 */
describe("a read, then words (D33, D37)", () => {
  const theMessage = "Shorten the second line of my Nexplore post.";
  const theReply = "Your Nexplore post has three lines; which words should go?";

  /** A chain answering the conversation's message: the whole profile read, then words. */
  const chain = (conversation: Conversation) =>
    withCases({
      [`chain:${conversation.id}`]: {
        stands_for: "the agent reads the whole profile, then asks",
        answers: theMessage,
        tool_calls: [{ id: "call_read", name: "read_profile", arguments: {} }],
        next: { content: theReply },
      },
    });

  /** The run, and the answers the mock picked, read before the cases are disposed of. */
  const run = async (conversation: Conversation, person: string) => {
    const cases = chain(conversation);
    try {
      const ran = await ranThrough(agent.run(profileAssistant, conversation, person));
      return {
        ...ran,
        picked: requestsAnswered()
          .map((each) => each.picked)
          .slice(-2),
      };
    } finally {
      cases.dispose();
    }
  };

  it("stores the call, the read and one spoken reply, and streams the read's own phrase", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const post = await standing(at.person, at.post);

    const ran = await run(conversation, at.person);

    expect(ran.thrown).toBeUndefined();
    const stored = await entries(conversation);
    expect(stored.map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(stored[2]?.parts).toEqual([
      { kind: "tool_use", id: "call_read", name: "read_profile", input: {}, arguments: "{}" },
    ]);
    expect(stored[3]?.parts).toEqual([
      {
        kind: "tool_result",
        id: "call_read",
        name: "read_profile",
        read: { items: [{ ...post, concerns: [] }] },
      },
    ]);
    expect(stored[4]?.parts).toEqual([{ kind: "text", text: theReply }]);
    // One spoken reply: the words are the reply's alone.
    expect(textOf(ran.said)).toBe(theReply);
    expect(entriesOf(ran.said)).toEqual(stored.slice(2));
    expect(ran.said.flatMap((each) => (each.kind === "activity" ? [each.text] : []))).toEqual([
      "Thinking about your message",
      "Reading your profile",
      "Thinking it through",
    ]);
  });

  it("asks with the prompt, then the history alone, and hands the read back as the tool message", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    const post = await standing(at.person, at.post);

    const { picked } = await run(conversation, at.person);

    expect(requestsSent()).toHaveLength(2);
    for (const index of requestsSent().keys()) {
      const roles = bodyOf(index).messages.map((message) => message.role);
      expect(roles.lastIndexOf("system")).toBe(0);
      expect(JSON.stringify(bodyOf(index).messages.slice(1, 3))).not.toContain(at.lines[0]);
    }
    expect(bodyOf(1).messages.map((message) => message.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
      "tool",
    ]);
    const read = bodyOf(1).messages[4];
    expect(read?.tool_call_id).toBe("call_read");
    expect(JSON.parse(String(read?.content))).toEqual({ items: [{ ...post, concerns: [] }] });
    // The mock's own evidence: the file, then its link.
    expect(picked).toEqual([`chain:${conversation.id}`, `chain:${conversation.id}#next`]);
  });

  it("sends the read back the same bytes on the next message, read from the store", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    await run(conversation, at.person);
    const inStep = bodyOf(1).messages[4]?.content;
    await testDb.transaction((tx) =>
      append(tx, conversation, "person", [{ kind: "text", text: "Thanks." }]),
    );
    forgetRequests();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await ranThrough(agent.run(profileAssistant, conversation, at.person));

    const reloaded = bodyOf(0).messages.find((message) => message.role === "tool");
    expect(reloaded?.content).toBe(inStep);
  });

  it("writes nothing of a step whose read cannot be stored, and throws (D21)", async () => {
    const at = await planted();
    await testDb
      .insert(itemLine)
      .values({ id: randomUUID(), itemId: at.post, text: "INJECTED-FAILURE-READ", position: 3 });
    const conversation = await conversationOf(at.person);
    const failure = await failingOn(testDb, "INJECTED-FAILURE-READ");

    let ran: { said: Ran[]; thrown: unknown };
    try {
      ran = await run(conversation, at.person);
    } finally {
      await failure.dispose();
    }

    expect(String(ran.thrown)).toMatch(/INJECTED-FAILURE-READ/);
    expect(entriesOf(ran.said)).toEqual([]);
    expect(requestsSent()).toHaveLength(1);
    expect((await entries(conversation)).map((entry) => entry.author)).toEqual([
      "assistant",
      "person",
    ]);
  });
});
