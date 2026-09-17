import type { Held } from "../answers";
import type { Frame } from "./frames";

/**
 * Anthropic's messages envelope, whole and streamed, transcribed from
 * `platform.claude.com`'s messages and streaming references, read 2026-09-12.
 *
 * The same recorded case as the other envelope, wrapped differently: the text sits at
 * `content[0].text` rather than `choices[0].message.content`, the counts are input and
 * output with no total, and the stop reason is `end_turn` rather than `stop`.
 *
 * A call is a `tool_use` content block after the text, its input an **object** (`ID190`);
 * streamed, the block opens with an empty input and the input arrives as
 * `input_json_delta` carrying `partial_json` fragments. An answer with calls stops on
 * `tool_use`.
 */

const identifier = () => `msg_${crypto.randomUUID().replaceAll("-", "")}`;

type Call = Held["tool_calls"][number];

/** The input as JSON text, which is what a stream's fragments carry. */
const inputText = (call: Call): string =>
  typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});

/** The input as an object, which is what a whole answer carries; `{}` if it does not parse. */
const inputOf = (call: Call): unknown => {
  try {
    return JSON.parse(inputText(call));
  } catch {
    return {};
  }
};

const stopOf = (recorded: Held): string =>
  recorded.tool_calls.length === 0 ? "end_turn" : "tool_use";

/** The whole answer. */
export const anthropicWhole = (recorded: Held, model: string) => ({
  id: identifier(),
  type: "message",
  role: "assistant",
  model,
  content: [
    { type: "text", text: recorded.content },
    ...recorded.tool_calls.map((call) => ({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: inputOf(call),
    })),
  ],
  stop_reason: stopOf(recorded),
  stop_sequence: null,
  usage: {
    input_tokens: recorded.usage.input_tokens,
    output_tokens: recorded.usage.output_tokens,
  },
});

/**
 * The stream: named events, each carrying its own `type` in the data, in the order the
 * reference gives — `message_start`, then per content block a `content_block_start`,
 * its `content_block_delta` events and a `content_block_stop`, then `message_delta`,
 * then `message_stop`. The text is block 0; each call is the block after it.
 *
 * **There is no sentinel here.** `message_stop` ends it, which is the second way the
 * two protocols differ: not only in what they carry but in how they finish.
 *
 * `message_start` carries the message with empty content and an output count of 1, and
 * the count in `message_delta.usage` is cumulative, as the reference has them.
 */
export const anthropicFrames = (model: string, chunks: string[], recorded: Held): Frame[] => {
  const id = identifier();
  const frame = (event: string, data: object, paced = false): Frame => ({
    event,
    data: JSON.stringify({ type: event, ...data }),
    paced,
  });

  return [
    frame("message_start", {
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: recorded.usage.input_tokens, output_tokens: 1 },
      },
    }),
    frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ...chunks.map((text) =>
      frame("content_block_delta", { index: 0, delta: { type: "text_delta", text } }, true),
    ),
    frame("content_block_stop", { index: 0 }),
    ...recorded.tool_calls.flatMap((call, at) => [
      frame("content_block_start", {
        index: at + 1,
        content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
      }),
      frame(
        "content_block_delta",
        { index: at + 1, delta: { type: "input_json_delta", partial_json: inputText(call) } },
        true,
      ),
      frame("content_block_stop", { index: at + 1 }),
    ]),
    frame("message_delta", {
      delta: { stop_reason: stopOf(recorded), stop_sequence: null },
      usage: { output_tokens: recorded.usage.output_tokens },
    }),
    frame("message_stop", {}),
  ];
};
