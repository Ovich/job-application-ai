import { describe, expect, it } from "vitest";
import { app } from "../../../src/app";
import { withCases } from "../../support/ai";
import {
  anthropicEvent,
  anthropicWhole,
  framesOf,
  openAiChunk,
  openAiWhole,
} from "../../support/envelopes";

/**
 * Seam A, the envelopes' half: a recorded answer that calls a tool (`S4.1`, `ID190`).
 *
 * The answer document holds its calls once, in a neutral shape `{ id, name, arguments }`,
 * and each envelope wraps them as its own protocol does: OpenAI as `tool_calls` with the
 * arguments as a JSON string and `finish_reason: "tool_calls"`, Anthropic as `tool_use`
 * content blocks with the input as an object, streamed as `input_json_delta`, and
 * `stop_reason: "tool_use"`. Every body is validated against the makers' shapes in
 * `tests/support/envelopes.ts`, never against the mock's own.
 *
 * `lib/ai` reads only the OpenAI envelope, so the Anthropic envelope is proved here, at
 * the mock's own paths, and nowhere else.
 */

const step = "profile.message:conversation-1#1" as const;

const edit = {
  itemId: "item-nexplore",
  operations: [{ op: "replace_line", lineId: "line-2", text: "Shipped the platform." }],
};

const recorded = {
  [step]: {
    stands_for: "a step that edits the profile, then says so",
    content: "I shortened the second line.",
    tool_calls: [{ id: "call_1", name: "edit_profile", arguments: edit }],
    usage: { input_tokens: 900, output_tokens: 40 },
  },
};

const ask = (path: string, body: object, pace = "tps=1000;chunk=1") =>
  app.request(`/mock/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Jobapp-Case": step,
      "X-Jobapp-Mock-Pace": pace,
    },
    body: JSON.stringify({ model: "m", messages: [], ...body }),
  });

describe("a recorded tool call, OpenAI's envelope", () => {
  it("answers whole with the call, its arguments a JSON string, and finish_reason tool_calls", async () => {
    const cases = withCases(recorded);
    try {
      const body = openAiWhole.parse(await (await ask("/chat/completions", {})).json());

      expect(body.choices[0]?.finish_reason).toBe("tool_calls");
      expect(body.choices[0]?.message.content).toBe("I shortened the second line.");
      expect(body.choices[0]?.message.tool_calls).toEqual([
        {
          id: "call_1",
          type: "function",
          function: { name: "edit_profile", arguments: JSON.stringify(edit) },
        },
      ]);
    } finally {
      cases.dispose();
    }
  });

  it("streams the text, then the call in delta.tool_calls, and ends on tool_calls and [DONE]", async () => {
    const cases = withCases(recorded);
    try {
      const frames = framesOf(await (await ask("/chat/completions", { stream: true })).text());

      expect(frames.at(-1)).toEqual({ data: "[DONE]" });
      const chunks = frames.slice(0, -1).map((frame) => openAiChunk.parse(JSON.parse(frame.data)));
      const choices = chunks.map((chunk) => chunk.choices[0]);
      expect(choices.map((choice) => choice?.delta.content ?? "").join("")).toBe(
        "I shortened the second line.",
      );
      const calls = choices.flatMap((choice) => choice?.delta.tool_calls ?? []);
      expect(calls[0]).toMatchObject({
        index: 0,
        id: "call_1",
        type: "function",
        function: { name: "edit_profile" },
      });
      expect(calls.map((call) => call.function.arguments ?? "").join("")).toBe(
        JSON.stringify(edit),
      );
      // Every text piece comes before the first call's delta.
      const lastText = choices.findLastIndex((choice) => choice?.delta.content !== undefined);
      const firstCall = choices.findIndex((choice) => choice?.delta.tool_calls !== undefined);
      expect(lastText).toBeLessThan(firstCall);
      expect(choices.at(-1)?.finish_reason).toBe("tool_calls");
      expect(choices.slice(0, -1).map((choice) => choice?.finish_reason)).toEqual(
        choices.slice(0, -1).map(() => null),
      );
    } finally {
      cases.dispose();
    }
  });
});

describe("a recorded tool call, Anthropic's envelope", () => {
  it("answers whole with a text block, then a tool_use block holding the input, and stop_reason tool_use", async () => {
    const cases = withCases(recorded);
    try {
      const body = anthropicWhole.parse(
        await (await ask("/messages", { max_tokens: 100 })).json(),
      );

      expect(body.stop_reason).toBe("tool_use");
      expect(body.content).toEqual([
        { type: "text", text: "I shortened the second line." },
        { type: "tool_use", id: "call_1", name: "edit_profile", input: edit },
      ]);
    } finally {
      cases.dispose();
    }
  });

  it("streams the text block, then a tool_use block in input_json_delta pieces, and stops on tool_use", async () => {
    const cases = withCases(recorded);
    try {
      const frames = framesOf(
        await (await ask("/messages", { max_tokens: 100, stream: true })).text(),
      );
      const events = frames.map((frame) => anthropicEvent.parse(JSON.parse(frame.data)));

      expect(events.map((event) => event.type)).toEqual(frames.map((frame) => frame.event));
      const starts = events.flatMap((event) =>
        event.type === "content_block_start" ? [event] : [],
      );
      expect(starts.map((start) => [start.index, start.content_block.type])).toEqual([
        [0, "text"],
        [1, "tool_use"],
      ]);
      expect(starts[1]?.content_block).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "edit_profile",
        input: {},
      });
      const deltas = events.flatMap((event) =>
        event.type === "content_block_delta" ? [event] : [],
      );
      expect(
        deltas.map((delta) => (delta.delta.type === "text_delta" ? delta.delta.text : "")).join(""),
      ).toBe("I shortened the second line.");
      const partial = deltas
        .filter((delta) => delta.index === 1)
        .map((delta) => (delta.delta.type === "input_json_delta" ? delta.delta.partial_json : ""))
        .join("");
      expect(JSON.parse(partial)).toEqual(edit);
      const stopped = events.find((event) => event.type === "message_delta");
      expect(stopped?.type === "message_delta" ? stopped.delta.stop_reason : null).toBe("tool_use");
      expect(events.at(-1)?.type).toBe("message_stop");
    } finally {
      cases.dispose();
    }
  });
});
