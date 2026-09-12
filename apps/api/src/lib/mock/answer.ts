import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";
import { caseNamed, casesHeld, type RecordedCase } from "./answers";
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
 * The document comes last to `frames` because one protocol's stream does not need it: see
 * `openai-envelope.ts`.
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

const answer = async (c: Context, envelope: Envelope, configured: Pace) => {
  const name = c.req.header("X-Jobapp-Case") ?? null;
  const recorded = caseNamed(name);

  // A miss says the case it was asked for, what it holds, and how to write a new one.
  // No pass-through and no generic answer: a test that reaches an unanswered path has
  // to fail rather than pass on something invented (ID113).
  if (recorded === undefined) {
    return c.json(
      {
        error: `No recorded case ${name ?? "(none named in X-Jobapp-Case)"}. Record it with the intake's recording script, or add its file under apps/api/src/lib/mock/documents/<feature>/.`,
        case: name,
        held: casesHeld(),
      },
      404,
    );
  }

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
