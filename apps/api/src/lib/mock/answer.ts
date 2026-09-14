import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { caseNamed, type RecordedCase } from "./answers";
import { anthropicFrames, anthropicWhole } from "./anthropic-envelope";
import type { Frame } from "./frames";
import { openAiFrames, openAiWhole } from "./openai-envelope";
import { chunksOf, intervalMs, type Pace, paceOf } from "./pace";

/**
 * The double's two answers, **as handlers rather than as a router** (`ID146`, amending
 * `ID109`; the person's own comment: *"We dont need the mock to expose the routes, just
 * expose them as our typical handlers"*).
 *
 * Nothing here constructs a `Hono`. The paths are a route file's, exactly as
 * `routes/intake.ts` holds the intake's, so the file that mounts this module is the file
 * that decides where it is mounted — and this module is standalone enough to be mounted
 * somewhere else, or not at all (`ID150`).
 *
 * It holds no client and imports nothing that could open a connection, so a case it does
 * not have is a failure and never a call: a double that can reach the network can spend
 * money and can hide a missing answer behind a real one (spec `D20`).
 *
 * The two handlers are the two envelopes, and they are the only thing that differs
 * between them. One answer document answers on both, wrapped by its own serialiser,
 * streamed or whole by the protocol's own `stream: true`.
 */

/**
 * Which wrapper a handler puts an answer in. The document itself names no protocol, which
 * is the whole of `D11`: one answer, two envelopes, and a document that does not move the
 * day a provider is reached in the other shape.
 *
 * The document comes last to `frames`, after the pieces of its content the pace cut.
 */
type Envelope = {
  whole: (recorded: RecordedCase, model: string) => object;
  frames: (model: string, chunks: string[], recorded: RecordedCase) => Frame[];
};

const openAi: Envelope = { whole: openAiWhole, frames: openAiFrames };
const anthropic: Envelope = { whole: anthropicWhole, frames: anthropicFrames };

/** What a request may say. The rest of a real provider's body is accepted and ignored. */
type Asked = { model?: unknown; stream?: unknown };

const wait = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise((done) => setTimeout(done, ms));

/**
 * What a miss answers (`ID166`, amending `ID113`): this text and nothing else, shaped as
 * a recorded case so either envelope wraps it as it wraps any other. Never a guess at
 * another case, and never a call. A structured call still fails on it, because it is
 * not JSON; a free message gets a reply a person can read.
 */
const placeholder = (name: string | null): RecordedCase => ({
  case: name ?? "(none named)",
  stands_for: "a case nobody recorded",
  content: "No pre generated text",
  tool_calls: [],
  usage: { input_tokens: 0, output_tokens: 0 },
});

const answer = async (c: Context, envelope: Envelope, configured: Pace) => {
  const name = c.req.header("X-Jobapp-Case") ?? null;
  const held = caseNamed(name);

  // The answer no longer says which case was missed, so the log does, in one line
  // (`ID198`). A case name holds a conversation id or a document slug, no personal data.
  if (held === undefined) {
    console.warn(
      `mock: no recorded case ${name ?? "(none named in X-Jobapp-Case)"}; answered "No pre generated text". Add its file under apps/api/src/lib/mock/documents/<feature>/.`,
    );
  }
  const recorded = held ?? placeholder(name);

  const asked = (await c.req.json().catch(() => ({}))) as Asked;
  const model = typeof asked.model === "string" ? asked.model : "mock-model";
  const pace = paceOf(c.req.raw.headers, configured);

  if (asked.stream !== true) return c.json(envelope.whole(recorded, model));

  const frames = envelope.frames(model, chunksOf(recorded.content, pace), recorded);

  return streamSSE(c, async (out) => {
    await wait(pace.timeToFirstTokenMs);
    let written = 0;
    for (const frame of frames) {
      if (frame.paced === true) {
        if (written > 0) await wait(intervalMs(pace));
        written += 1;
      }
      await out.writeSSE(frame.event === undefined ? { data: frame.data } : frame);
    }
  });
};

const factory = createFactory();

/**
 * The two handlers, given the pace their answers fall back to when a request asks for
 * none. The pace is configuration, so this module still reads no environment of its own.
 */
export const createAnswers = (configured: Pace) => ({
  chatCompletions: factory.createHandlers((c) => answer(c, openAi, configured)),
  messages: factory.createHandlers((c) => answer(c, anthropic, configured)),
});
