import { z } from "zod";

/**
 * The two protocols' published shapes, written down so the mock's answers can be
 * validated against them field for field (ID135).
 *
 * They are transcribed from the makers' own references, read 2026-09-12: OpenAI's
 * OpenAPI document for `CreateChatCompletionResponse` and
 * `CreateChatCompletionStreamResponse`, and `platform.claude.com`'s messages and
 * streaming references. A field this product never reads is still required here,
 * because an absent required field is where a client library starts guessing, and the
 * whole point of the double is that a caller cannot tell it from a provider.
 *
 * They live in the suite, not in `src`: the mock must be written to the protocol, not
 * to a schema the mock itself exports, or the test would only prove the mock agrees
 * with itself.
 */

/** `POST /chat/completions`, whole. Required: id, object, created, model, choices, usage. */
export const openAiWhole = z.object({
  id: z.string().min(1),
  object: z.literal("chat.completion"),
  created: z.number().int().positive(),
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string(),
          refusal: z.null(),
          tool_calls: z.null(),
        }),
        finish_reason: z.enum(["stop", "tool_calls"]),
        logprobs: z.null(),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});

/**
 * One `data:` line of the OpenAI stream. `object` is a different literal from the whole
 * answer's, and `finish_reason` is `null` on every chunk but the last.
 */
export const openAiChunk = z.object({
  id: z.string().min(1),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int().positive(),
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        delta: z.object({
          role: z.literal("assistant").optional(),
          content: z.string().optional(),
        }),
        finish_reason: z.enum(["stop", "tool_calls"]).nullable(),
        logprobs: z.null(),
      }),
    )
    .min(1),
});

/** `POST /v1/messages`, whole. The text is at `content[0].text`, the counts input/output. */
export const anthropicWhole = z.object({
  id: z.string().min(1),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string().min(1),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
  stop_reason: z.enum(["end_turn", "tool_use"]),
  stop_sequence: z.null(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

/**
 * The named events of Anthropic's stream, each carrying its own `type` in the data.
 * `message_start` carries the message with empty content and an output count of 1;
 * the counts in `message_delta` are cumulative.
 */
export const anthropicEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message_start"),
    message: z.object({
      id: z.string().min(1),
      type: z.literal("message"),
      role: z.literal("assistant"),
      content: z.array(z.never()).length(0),
      model: z.string().min(1),
      stop_reason: z.null(),
      stop_sequence: z.null(),
      usage: z.object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.literal(1),
      }),
    }),
  }),
  z.object({
    type: z.literal("content_block_start"),
    index: z.number().int().nonnegative(),
    content_block: z.object({ type: z.literal("text"), text: z.literal("") }),
  }),
  z.object({
    type: z.literal("content_block_delta"),
    index: z.number().int().nonnegative(),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
  }),
  z.object({ type: z.literal("content_block_stop"), index: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({
      stop_reason: z.enum(["end_turn", "tool_use"]),
      stop_sequence: z.null(),
    }),
    usage: z.object({ output_tokens: z.number().int().nonnegative() }),
  }),
  z.object({ type: z.literal("message_stop") }),
]);

/** One SSE frame as it came off the wire: the `event:` name, if any, and the `data:` line. */
export type Frame = { event?: string; data: string };

/**
 * The frames of an `text/event-stream` body, split the way a client splits them. The
 * `data:` line is returned as text, not parsed, because one of the things under test is
 * that OpenAI's last frame is the literal `[DONE]` and not JSON at all.
 */
export const framesOf = (body: string): Frame[] =>
  body
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
      const data = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");
      return event === undefined ? { data } : { event, data };
    });
