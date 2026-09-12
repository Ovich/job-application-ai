import type { RecordedCase } from "./fixtures";
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
 */

const identifier = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;
const now = () => Math.floor(Date.now() / 1000);

/** The whole answer. `object` is exactly `chat.completion`. */
export const openAiWhole = (recorded: RecordedCase, model: string) => ({
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
        tool_calls: null,
      },
      finish_reason: "stop",
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: recorded.usage.input_tokens,
    completion_tokens: recorded.usage.output_tokens,
    total_tokens: recorded.usage.input_tokens + recorded.usage.output_tokens,
  },
});

/**
 * The stream: one `data:` line per chunk, then the literal sentinel.
 *
 * `object` is `chat.completion.chunk`, a different value from the whole answer's. The
 * first chunk's delta carries the role, the middle ones the content, and the last an
 * empty delta with the `finish_reason`, which is `null` on every chunk before it.
 *
 * The stream ends with `data: [DONE]`, which is not JSON. A client that parses it as
 * JSON breaks, so it is written out here rather than left to be remembered — and it is
 * the one thing that makes this protocol end differently from the other.
 *
 * The recorded case is not needed here, only its pieces: this protocol carries no
 * `usage` in a stream unless the request asked for it with `stream_options`, and no
 * request of ours does. The other envelope does carry it, which is why the serialisers
 * are given the case last and this one simply does not take it.
 */
export const openAiFrames = (model: string, chunks: string[]): Frame[] => {
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
    chunk({}, "stop"),
    { data: "[DONE]" },
  ];
};
