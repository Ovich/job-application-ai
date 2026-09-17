import type { Held } from "../answers";
import type { Frame } from "./frames";

/**
 * OpenAI's chat-completions envelope, whole and streamed, transcribed from the maker's
 * own OpenAPI document (`CreateChatCompletionResponse` and
 * `CreateChatCompletionStreamResponse`), read 2026-09-12.
 *
 * Every field the schema marks required is emitted, including the ones this product
 * never reads: an absent required field is where a client library starts guessing, and
 * a caller must not be able to tell this apart from a provider.
 *
 * The case's counts are written in the envelope-independent names, input and output.
 * Here they become prompt, completion and total, which is not what the other envelope
 * calls them.
 *
 * A call is a `function` tool call whose arguments are a JSON **string**, as the model
 * wrote them (`ID190`): the other envelope carries an object.
 */

const identifier = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
const now = () => Math.floor(Date.now() / 1000);

/** The case's counts in this protocol's names, whole or streamed. */
const usageOf = (recorded: Held) => ({
  prompt_tokens: recorded.usage.input_tokens,
  completion_tokens: recorded.usage.output_tokens,
  total_tokens: recorded.usage.input_tokens + recorded.usage.output_tokens,
});

type Call = Held["tool_calls"][number];

/** The arguments as this protocol carries them: the string itself, or the object as JSON. */
const argumentsOf = (call: Call): string =>
  typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});

/** Why the answer stopped: on its calls when it has any. */
const finishOf = (recorded: Held): string =>
  recorded.tool_calls.length === 0 ? "stop" : "tool_calls";

/** The whole answer. `object` is exactly `chat.completion`. */
export const openAiWhole = (recorded: Held, model: string) => ({
  id: identifier(),
  object: "chat.completion",
  created: now(),
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: recorded.content,
        refusal: null,
        // `null` with no call, never an empty list, as the protocol has it.
        tool_calls:
          recorded.tool_calls.length === 0
            ? null
            : recorded.tool_calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: argumentsOf(call) },
              })),
      },
      finish_reason: finishOf(recorded),
      logprobs: null,
    },
  ],
  usage: usageOf(recorded),
});

/**
 * The stream: one `data:` line per chunk, then the literal sentinel.
 *
 * `object` is `chat.completion.chunk`, a different value from the whole answer's. The
 * first chunk's delta carries the role, the middle ones the content, then each call —
 * its `id`, `type` and `name` in one delta, its arguments in the next — and the last an
 * empty delta with the `finish_reason`, which is `null` on every chunk before it.
 *
 * The stream ends with `data: [DONE]`, which is not JSON. A client that parses it as
 * JSON breaks, so it is written out here rather than left to be remembered — and it is
 * the one thing that makes this protocol end differently from the other.
 *
 * This protocol carries no `usage` in a stream unless the request asked for it with
 * `stream_options.include_usage` (D29). When asked, one more chunk comes after the
 * finish and before the sentinel: an empty `choices` list and the case's counts, named
 * as the whole answer names them. A request not asking gets no such chunk.
 */
export const openAiFrames = (
  model: string,
  chunks: string[],
  recorded: Held,
  asked: { includeUsage: boolean },
): Frame[] => {
  const id = identifier();
  const created = now();
  const chunk = (delta: object, finish: string | null, paced = false): Frame => ({
    data: JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
    }),
    paced,
  });

  return [
    chunk({ role: "assistant" }, null),
    ...chunks.map((text) => chunk({ content: text }, null, true)),
    ...recorded.tool_calls.flatMap((call, index) => [
      chunk(
        {
          tool_calls: [
            { index, id: call.id, type: "function", function: { name: call.name, arguments: "" } },
          ],
        },
        null,
      ),
      chunk({ tool_calls: [{ index, function: { arguments: argumentsOf(call) } }] }, null, true),
    ]),
    chunk({}, finishOf(recorded)),
    ...(asked.includeUsage
      ? [
          {
            data: JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [],
              usage: usageOf(recorded),
            }),
          },
        ]
      : []),
    { data: "[DONE]" },
  ];
};
