import { parts } from "@app/db";
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { profileAssistant } from "../../../src/assistants/profile";
import { asMessages as asMessagesWith } from "../../../src/lib/agent/messages";
import type { Entry } from "../../../src/lib/conversation";

/**
 * Seam D: `lib/agent`, the entries as the model reads them (`S4.3`, `ID162`, `ID161`,
 * OD7). It moved here with the function, whose knowledge is the agent's; the cases are
 * the ones `lib/conversation` held, unchanged.
 *
 * Behind it: nothing, it is in process. Every part a case serialises is first parsed by
 * the catalogue, so what is serialised is a part a writer could have stored. What is
 * asserted is the `@langchain/core` message the model is handed, compared as what the
 * model's converter reads of it: its type, its content, and its calls or the call it answers.
 */

// The wording of the non-core parts is the definition's (D11): the cases below read the
// profile assistant's own words, and the stand-in cases a `describe` of their own.
const asMessages = (said: Entry[]) => asMessagesWith(said, profileAssistant.describe);

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

/** What the converter reads of a message. */
const seen = (message: BaseMessage) => ({
  type: message.type,
  content: message.content,
  ...(AIMessage.isInstance(message) ? { tool_calls: message.tool_calls } : {}),
  ...(ToolMessage.isInstance(message)
    ? { tool_call_id: message.tool_call_id, name: message.name }
    : {}),
});

const seenAll = (messages: BaseMessage[]) => messages.map(seen);

const human = (content: string) => ({ type: "human", content });
const call = (id: string, args: Record<string, unknown>) => ({
  id,
  name: "edit_profile",
  args,
  type: "tool_call" as const,
});
const answer = (id: string, content: unknown) => ({
  type: "tool",
  content: JSON.stringify(content),
  tool_call_id: id,
  name: "edit_profile",
});

describe("each part, as the LangChain agent reads it (spec 3.3)", () => {
  it("renders the person's text as a HumanMessage", () => {
    const messages = asMessages([
      entry("person", [{ kind: "text", text: "Shorten the second line." }]),
    ]);

    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(seenAll(messages)).toEqual([human("Shorten the second line.")]);
  });

  it("renders the product's scripted words as an AIMessage", () => {
    const messages = asMessages([
      entry("assistant", [{ kind: "text", text: "First, Java.", scripted: true }]),
    ]);

    expect(messages[0]).toBeInstanceOf(AIMessage);
    expect(seenAll(messages)).toEqual([{ type: "ai", content: "First, Java.", tool_calls: [] }]);
  });

  it("renders an assistant's text and tool_use as one AIMessage carrying its call", () => {
    expect(
      seenAll(
        asMessages([
          entry("assistant", [
            { kind: "text", text: "I will shorten it." },
            { kind: "tool_use", id: "call_1", name: "edit_profile", input: edit },
          ]),
        ]),
      ),
    ).toEqual([{ type: "ai", content: "I will shorten it.", tool_calls: [call("call_1", edit)] }]);
  });

  it("renders a tool_use with no text as an AIMessage with empty content", () => {
    expect(
      seenAll(
        asMessages([
          entry("assistant", [
            { kind: "tool_use", id: "call_1", name: "edit_profile", input: edit },
          ]),
        ]),
      ),
    ).toEqual([{ type: "ai", content: "", tool_calls: [call("call_1", edit)] }]);
  });

  it("gives a tool_use's arguments back as the model's string parsed, its keys in the model's order (D23, ID206)", () => {
    const written =
      '{"operations": [{"text": "Shipped.", "op": "remove_line"}],  "itemId": "item-nexplore"}';

    const [message] = asMessages([
      entry("assistant", [
        {
          kind: "tool_use",
          id: "call_1",
          name: "edit_profile",
          // The input stored in another order: the string, not the input, is what goes back.
          input: { itemId: "item-nexplore", operations: [{ op: "remove_line", text: "Shipped." }] },
          arguments: written,
        },
      ]),
    ]);
    if (message === undefined || !AIMessage.isInstance(message)) throw new Error("no AIMessage");
    const args = message.tool_calls?.[0]?.args ?? {};

    expect(seen(message)).toEqual({
      type: "ai",
      content: "",
      tool_calls: [call("call_1", JSON.parse(written))],
    });
    expect(JSON.stringify(args)).toBe(
      '{"operations":[{"text":"Shipped.","op":"remove_line"}],"itemId":"item-nexplore"}',
    );
    expect(message.additional_kwargs).toEqual({});
  });

  it("renders an applied tool_result as a ToolMessage answering that call, before and after", () => {
    const messages = asMessages([
      entry("tool", [{ kind: "tool_result", id: "call_1", name: "edit_profile", before, after }]),
    ]);

    expect(messages[0]).toBeInstanceOf(ToolMessage);
    expect(seenAll(messages)).toEqual([answer("call_1", { before, after })]);
  });

  it("renders a refused tool_result as a ToolMessage carrying the reason", () => {
    expect(
      seenAll(
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
      ),
    ).toEqual([answer("call_2", { refused: "The line line-9 no longer exists on this item." })]);
  });

  it("renders a tool entry of two results as two ToolMessages, in order", () => {
    expect(
      seenAll(
        asMessages([
          entry("tool", [
            { kind: "tool_result", id: "call_1", name: "edit_profile", before, after },
            { kind: "tool_result", id: "call_2", name: "edit_profile", refused: "No." },
          ]),
        ]),
      ),
    ).toEqual([answer("call_1", { before, after }), answer("call_2", { refused: "No." })]);
  });
});

describe("the person's tool use, as the LangChain agent reads it (S7.2)", () => {
  const asked = {
    lead: "Which was it?",
    where: "What you work with · DevOps and cloud",
    options: [
      { id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" },
      { id: "q1-2", label: "Ran services on it", hint: "deployed and operated the workloads" },
    ],
  };

  it("renders an answer as a HumanMessage naming the question, the option picked and the words", () => {
    expect(
      seenAll(
        asMessages([
          entry("person", [
            { kind: "question_answered", ...asked, picked: "q1-2", words: "three clusters" },
          ]),
        ]),
      ),
    ).toEqual([
      human(
        'I answered "Which was it?" (What you work with · DevOps and cloud): Ran services on it (deployed and operated the workloads). In my own words: three clusters',
      ),
    ]);
  });

  it("renders an answer with no words as the question and the option picked", () => {
    expect(
      seenAll(
        asMessages([
          entry("person", [{ kind: "question_answered", ...asked, picked: "q1-1", words: null }]),
        ]),
      ),
    ).toEqual([
      human(
        'I answered "Which was it?" (What you work with · DevOps and cloud): Ran the cluster (nodes, upgrades, access).',
      ),
    ]);
  });

  it("renders an answer in words alone as the question and the words", () => {
    expect(
      seenAll(
        asMessages([
          entry("person", [
            { kind: "question_answered", ...asked, picked: null, words: "only the Helm charts" },
          ]),
        ]),
      ),
    ).toEqual([
      human(
        'I answered "Which was it?" (What you work with · DevOps and cloud) in my own words: only the Helm charts',
      ),
    ]);
  });

  it("renders a skip as a HumanMessage saying the question was skipped", () => {
    expect(
      seenAll(asMessages([entry("person", [{ kind: "question_skipped", ...asked }])])),
    ).toEqual([
      human(
        'I skipped "Which was it?" (What you work with · DevOps and cloud) for now, without answering it.',
      ),
    ]);
  });
});

describe("a message about an item, as the LangChain agent reads it (S8.7)", () => {
  it("renders the about part and the words as one HumanMessage naming where and the ids", () => {
    expect(
      seenAll(
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
      ),
    ).toEqual([
      human(
        'About "Platform engineer · row 2" (itemId item-nexplore, lineId line-2):\n\nSomebody else wrote this.',
      ),
    ]);
  });

  it("names the item alone when the message is about the item", () => {
    expect(
      seenAll(
        asMessages([
          entry("person", [
            { kind: "about", itemId: "item-nexplore", where: "Platform engineer" },
            { kind: "text", text: "It was part-time." },
          ]),
        ]),
      ),
    ).toEqual([human('About "Platform engineer" (itemId item-nexplore):\n\nIt was part-time.')]);
  });
});

describe("a part beyond text and tools, as the definition describes it, for the LangChain agent (D11)", () => {
  const skipped = {
    kind: "question_skipped",
    lead: "Which was it?",
    where: "What you work with",
    options: [{ id: "q1-1", label: "Ran the cluster", hint: "nodes" }],
  };

  it("renders text and tool parts itself, whatever describe says", () => {
    expect(
      seenAll(
        asMessagesWith(
          [
            entry("person", [{ kind: "text", text: "Shorten it." }]),
            entry("assistant", [
              { kind: "tool_use", id: "call_1", name: "edit_profile", input: edit },
            ]),
            entry("tool", [
              { kind: "tool_result", id: "call_1", name: "edit_profile", before, after },
            ]),
          ],
          () => "never asked",
        ),
      ),
    ).toEqual([
      human("Shorten it."),
      { type: "ai", content: "", tool_calls: [call("call_1", edit)] },
      answer("call_1", { before, after }),
    ]);
  });

  it("reads question_answered, question_skipped and about in the words describe gives", () => {
    const described = (part: Record<string, unknown>) => `[${String(part["kind"])}]`;

    expect(
      seenAll(
        asMessagesWith(
          [
            entry("person", [
              { ...skipped, kind: "question_answered", picked: "q1-1", words: null },
            ]),
            entry("person", [skipped]),
            entry("person", [
              { kind: "about", itemId: "item-1", where: "Kubernetes" },
              { kind: "text", text: "Only the charts." },
            ]),
          ],
          described,
        ),
      ),
    ).toEqual([
      human("[question_answered]"),
      human("[question_skipped]"),
      human("[about]\n\nOnly the charts."),
    ]);
  });

  it("leaves out a part describe answers null for", () => {
    expect(
      seenAll(
        asMessagesWith(
          [
            entry("person", [skipped]),
            entry("person", [
              { kind: "about", itemId: "item-1", where: "Kubernetes" },
              { kind: "text", text: "Only the charts." },
            ]),
          ],
          () => null,
        ),
      ),
    ).toEqual([human("Only the charts.")]);
  });
});

describe("a step, written and rendered again for the LangChain agent (spec 3.3)", () => {
  it("gives the model back its own message, then the tool's answer to it", () => {
    // The step as the LangChain model hands it over: the text and the call, parsed.
    const answered = new AIMessage({
      content: "I shortened the second line.",
      tool_calls: [call("call_7", edit)],
    });

    // Written as the loop writes it, read back as JSON, as a column gives it back.
    const written = JSON.parse(
      JSON.stringify([
        entry("assistant", [
          { kind: "text", text: "I shortened the second line." },
          { kind: "tool_use", id: "call_7", name: "edit_profile", input: edit },
        ]),
        entry("tool", [{ kind: "tool_result", id: "call_7", name: "edit_profile", before, after }]),
      ]),
    ) as Entry[];

    expect(seenAll(asMessages(written))).toEqual([
      seen(answered),
      answer("call_7", { before, after }),
    ]);
  });
});
