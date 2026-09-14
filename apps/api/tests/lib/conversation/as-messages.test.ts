import { parts } from "@app/db";
import { describe, expect, it, vi } from "vitest";
import type { Entry } from "../../../src/lib/conversation";

/**
 * Seam D: `lib/conversation`, `asMessages` (`S4.3`, `ID162`, `ID161`).
 *
 * Behind it: nothing, it is in process. Every part a case serialises is first parsed by
 * the catalogue, so what is serialised is a part a writer could have stored. What is
 * asserted is the message the model is handed, in the protocol's own shape.
 *
 * `lib/db` is stood in for only because `lib/conversation` imports it; nothing here
 * queries.
 */
vi.mock("../../../src/lib/db", async () => ({
  db: (await import("../../support/database")).testDb,
}));

const { asMessages } = await import("../../../src/lib/conversation");

let position = 0;

/** An entry of these parts, each parsed by the catalogue first. */
const entry = (author: Entry["author"], said: unknown[]): Entry => {
  position += 1;
  return {
    id: `entry-${position}`,
    position,
    author,
    parts: parts.parse(said),
    createdAt: new Date("2026-09-14T09:00:00.000Z"),
  };
};

const edit = {
  itemId: "item-nexplore",
  operations: [{ op: "replace_line", lineId: "line-2", text: "Shipped the platform." }],
};

const before = {
  id: "item-nexplore",
  title: "Platform engineer",
  lines: [{ id: "line-2", text: "Designed and shipped the platform." }],
};
const after = {
  id: "item-nexplore",
  title: "Platform engineer",
  lines: [{ id: "line-2", text: "Shipped the platform." }],
};

describe("each part, as the model reads it (S4.3)", () => {
  it("serialises the person's text as a user message", () => {
    expect(
      asMessages([entry("person", [{ kind: "text", text: "Shorten the second line." }])]),
    ).toEqual([{ role: "user", content: "Shorten the second line." }]);
  });

  it("serialises the product's scripted words as the assistant's", () => {
    expect(
      asMessages([entry("assistant", [{ kind: "text", text: "First, Java.", scripted: true }])]),
    ).toEqual([{ role: "assistant", content: "First, Java." }]);
  });

  it("serialises an assistant's text and tool_use as one assistant message carrying its call", () => {
    expect(
      asMessages([
        entry("assistant", [
          { kind: "text", text: "I will shorten it." },
          { kind: "tool_use", id: "call_1", name: "edit_profile", input: edit },
        ]),
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: "I will shorten it.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "edit_profile", arguments: JSON.stringify(edit) },
          },
        ],
      },
    ]);
  });

  it("serialises a tool_use with no text as an assistant message with no content", () => {
    expect(
      asMessages([
        entry("assistant", [{ kind: "tool_use", id: "call_1", name: "edit_profile", input: edit }]),
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "edit_profile", arguments: JSON.stringify(edit) },
          },
        ],
      },
    ]);
  });

  it("sends a tool_use's arguments back as the very string the model wrote, beside its parsed input (ID206)", () => {
    const written =
      '{"operations": [{"text": "Shipped.", "op": "remove_line"}],  "itemId": "item-nexplore"}';

    const [message] = asMessages([
      entry("assistant", [
        {
          kind: "tool_use",
          id: "call_1",
          name: "edit_profile",
          input: JSON.parse(written),
          arguments: written,
        },
      ]),
    ]);

    expect(message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "edit_profile", arguments: written } },
      ],
    });
  });

  it("serialises an applied tool_result as a tool message answering that call, before and after", () => {
    expect(
      asMessages([
        entry("tool", [{ kind: "tool_result", id: "call_1", name: "edit_profile", before, after }]),
      ]),
    ).toEqual([
      { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ before, after }) },
    ]);
  });

  it("serialises a refused tool_result as a tool message carrying the reason", () => {
    expect(
      asMessages([
        entry("tool", [
          {
            kind: "tool_result",
            id: "call_2",
            name: "edit_profile",
            refused: "The line line-9 no longer exists on this item.",
          },
        ]),
      ]),
    ).toEqual([
      {
        role: "tool",
        tool_call_id: "call_2",
        content: JSON.stringify({ refused: "The line line-9 no longer exists on this item." }),
      },
    ]);
  });

  it("serialises a tool entry of two results as two tool messages, in order", () => {
    const messages = asMessages([
      entry("tool", [
        { kind: "tool_result", id: "call_1", name: "edit_profile", before, after },
        { kind: "tool_result", id: "call_2", name: "edit_profile", refused: "No." },
      ]),
    ]);

    expect(messages.map((message) => message.role)).toEqual(["tool", "tool"]);
    expect(
      messages.map((message) => ("tool_call_id" in message ? message.tool_call_id : null)),
    ).toEqual(["call_1", "call_2"]);
  });
});

/**
 * The person's use of the assistant's tool, in words (`S7.2`, `ID209`): the agent reads
 * an answer or a skip as the person's own message, so it knows what was said and never
 * asks it again.
 */
describe("the person's tool use, as the model reads it (S7.2)", () => {
  const asked = {
    lead: "Which was it?",
    where: "What you work with · DevOps and cloud",
    options: [
      { id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" },
      { id: "q1-2", label: "Ran services on it", hint: "deployed and operated the workloads" },
    ],
  };

  it("serialises an answer as a user message naming the question, the option picked and the words", () => {
    expect(
      asMessages([
        entry("person", [
          { kind: "question_answered", ...asked, picked: "q1-2", words: "three clusters" },
        ]),
      ]),
    ).toEqual([
      {
        role: "user",
        content:
          'I answered "Which was it?" (What you work with · DevOps and cloud): Ran services on it (deployed and operated the workloads). In my own words: three clusters',
      },
    ]);
  });

  it("serialises an answer with no words as the question and the option picked", () => {
    expect(
      asMessages([
        entry("person", [{ kind: "question_answered", ...asked, picked: "q1-1", words: null }]),
      ]),
    ).toEqual([
      {
        role: "user",
        content:
          'I answered "Which was it?" (What you work with · DevOps and cloud): Ran the cluster (nodes, upgrades, access).',
      },
    ]);
  });

  it("serialises an answer in words alone as the question and the words", () => {
    expect(
      asMessages([
        entry("person", [
          { kind: "question_answered", ...asked, picked: null, words: "only the Helm charts" },
        ]),
      ]),
    ).toEqual([
      {
        role: "user",
        content:
          'I answered "Which was it?" (What you work with · DevOps and cloud) in my own words: only the Helm charts',
      },
    ]);
  });

  it("serialises a skip as a user message saying the question was skipped", () => {
    expect(asMessages([entry("person", [{ kind: "question_skipped", ...asked }])])).toEqual([
      {
        role: "user",
        content:
          'I skipped "Which was it?" (What you work with · DevOps and cloud) for now, without answering it.',
      },
    ]);
  });
});

/**
 * What the person writes about an item (agent-consolidation `S8.7`, `ID233`): one user
 * message naming where it is and both ids, then the words, so a tool call can target the
 * item and the line.
 */
describe("a message about an item, as the model reads it (S8.7)", () => {
  it("serialises the about part and the words as one user message naming where and the ids", () => {
    expect(
      asMessages([
        entry("person", [
          {
            kind: "about",
            itemId: "item-nexplore",
            lineId: "line-2",
            where: "Platform engineer · row 2",
          },
          { kind: "text", text: "Somebody else wrote this." },
        ]),
      ]),
    ).toEqual([
      {
        role: "user",
        content:
          'About "Platform engineer · row 2" (itemId item-nexplore, lineId line-2):\n\nSomebody else wrote this.',
      },
    ]);
  });

  it("names the item alone when the message is about the item", () => {
    expect(
      asMessages([
        entry("person", [
          { kind: "about", itemId: "item-nexplore", where: "Platform engineer" },
          { kind: "text", text: "It was part-time." },
        ]),
      ]),
    ).toEqual([
      {
        role: "user",
        content: 'About "Platform engineer" (itemId item-nexplore):\n\nIt was part-time.',
      },
    ]);
  });
});

describe("the catalogue's tool parts (ID161)", () => {
  it("refuses a tool_result that carries neither before and after nor a refusal", () => {
    expect(() =>
      parts.parse([{ kind: "tool_result", id: "call_1", name: "edit_profile" }]),
    ).toThrow();
  });

  it("refuses a tool_use with no call id", () => {
    expect(() => parts.parse([{ kind: "tool_use", name: "edit_profile", input: edit }])).toThrow();
  });
});

describe("a step, written and serialised again (S4.3)", () => {
  it("gives the model back its own message, then the tool's answer to it", () => {
    // The step as the model answered it, in the protocol's own shape.
    const answered = {
      role: "assistant",
      content: "I shortened the second line.",
      tool_calls: [
        {
          id: "call_7",
          type: "function",
          function: { name: "edit_profile", arguments: JSON.stringify(edit) },
        },
      ],
    };

    // Written as the loop writes it: the text and the call, then the tool's result, the
    // call's arguments parsed as `lib/ai` hands them over; read back as JSON, as a column
    // gives them back.
    const written = JSON.parse(
      JSON.stringify([
        entry("assistant", [
          { kind: "text", text: answered.content },
          { kind: "tool_use", id: "call_7", name: "edit_profile", input: edit },
        ]),
        entry("tool", [{ kind: "tool_result", id: "call_7", name: "edit_profile", before, after }]),
      ]),
    ) as Entry[];

    expect(asMessages(written)).toEqual([
      answered,
      { role: "tool", tool_call_id: "call_7", content: JSON.stringify({ before, after }) },
    ]);
  });
});
