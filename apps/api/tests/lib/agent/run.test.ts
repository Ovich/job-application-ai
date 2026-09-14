import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { itemExperience, itemLine, profileItem, user } from "@app/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Ai } from "../../../src/lib/ai";
import type { Conversation, Entry } from "../../../src/lib/conversation";

/**
 * Seam C: `lib/agent`, `run` (`S4.4`, `S4.5`, `ID179`, `ID180`, `ID182`, `ID187`,
 * `ID193`, `US2`, `US6`, the spec's *Failure modes*).
 *
 * Behind it: PGlite with the real migrations, and `lib/ai` through the application's own
 * mock, answered in process, with recorded cases per step (`ID182`). The definition is
 * the profile assistant as the composition root hands it over.
 *
 * What is read: what `run` yields, the conversation through `entries`, the item through
 * `lib/profile-edit`'s `apply` with no operation, and the requests `lib/ai` sent. No
 * table is read. Whether a transaction is open while the model is asked is held by the
 * code's shape and the review, not asserted here.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { testDb } = await import("../../support/database");
const { append, entries, open } = await import("../../../src/lib/conversation");
const { run, stepLimit } = await import("../../../src/lib/agent");
const { apply, profileEditTool } = await import("../../../src/lib/profile-edit");
const { profileAssistant } = await import("../../../src/assistants/profile");
const { aiThroughTheApp, forgetRequests, requestsSent, withCases } =
  await import("../../support/ai");
const { failingOn } = await import("../../support/failing-entry");

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

type Ran = { kind: "text"; text: string } | { kind: "entry"; entry: Entry };

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

    const { said, thrown } = await ranThrough(
      run(profileAssistant, conversation, at.person, aiThroughTheApp()),
    );

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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    expect(ran.said.map((each) => each.kind).filter((kind, i, all) => all[i - 1] !== kind)).toEqual(
      ["text", "entry", "text", "entry"],
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

    // Step 2 is handed the model's own message back, and the tool's answer to it (S4.3),
    // and the profile as it now stands, read fresh (ID193). The call's arguments and the
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
    expect(String(bodyOf(0).messages[1]?.content)).not.toContain("Shipped the developer platform.");
    expect(String(bodyOf(1).messages[1]?.content)).toContain("Shipped the developer platform.");
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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
    } finally {
      cases.dispose();
    }

    expect(stepLimit).toBe(5);
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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
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
    const ai = aiThroughTheApp();
    const failingSecond: Ai = {
      ...ai,
      askWithTools: (messages, about, tools) => {
        if (!about.input.endsWith("#2")) return ai.askWithTools(messages, about, tools);
        const gone = new Error("the model went away mid-stream");
        const calls = Promise.reject(gone);
        calls.catch(() => {});
        return {
          pieces: (async function* () {
            yield "Half a";
            throw gone;
          })(),
          calls,
        };
      },
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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, failingSecond));
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
});

describe("every request (S4.4, ID181, ID193)", () => {
  it("carries the profile definition's system prompt first, the profile second, and the edit tool", async () => {
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
      await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
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
      expect(messages[1]).toEqual({ role: "system", content: expect.stringContaining(at.post) });
      expect(tools).toEqual([
        {
          type: "function",
          function: {
            name: "edit_profile",
            description: profileEditTool.description,
            parameters: z.toJSONSchema(profileEditTool.input),
          },
        },
      ]);
    }
  });

  it("derives the edit tool's schema from profileEditTool's input, held by its snapshot", async () => {
    const at = await planted();
    const conversation = await conversationOf(at.person);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));

    // Vitest's own snapshot file, which the formatter leaves as the suite wrote it.
    const [tool] = bodyOf(0).tools;
    expect(tool?.function.parameters).toMatchSnapshot();
  });
});

/**
 * S4.5b, `ID206`: a provider's prompt cache keys on the bytes of what it was sent, so
 * step 2 must carry step 1's call exactly as the model wrote it — keys in its order, its
 * spacing — while the edit and the drawing read the parsed input.
 */
describe("the model's own arguments, byte for byte (S4.5b, ID206)", () => {
  it("gives step 2 the very arguments string step 1 received, and edits from the parsed input", async () => {
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
      ran = await ranThrough(run(profileAssistant, conversation, at.person, aiThroughTheApp()));
    } finally {
      cases.dispose();
    }

    expect(ran.thrown).toBeUndefined();
    const asked = bodyOf(1).messages.find((message) => message.tool_calls !== undefined) as
      { tool_calls: { function: { arguments: string } }[] } | undefined;
    expect(asked?.tool_calls[0]?.function.arguments).toBe(written);
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
