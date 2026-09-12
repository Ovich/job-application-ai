import { describe, expect, it } from "vitest";
import { app } from "../../../src/app";
import { withCases } from "../../support/ai";
import { anthropicEvent, framesOf, openAiChunk } from "../../support/envelopes";

/**
 * Streaming, which is the protocol's own `stream: true` and not an endpoint of ours.
 *
 * Three things are under test and they are separable. The envelope: each protocol's
 * chunks are its own, and each ends the way its own protocol ends — a literal
 * `data: [DONE]` on one side, `message_stop` and no sentinel at all on the other. The
 * pace: four named settings, configuration carrying the defaults and a header carrying
 * the exception. And the invariant that outlives both: whatever the pace, the pieces
 * joined equal the case's whole answer, character for character. A double that invents
 * or drops a character under one pace and not another is worse than no double.
 */

const cvFr = "intake.classify:2026-08-30_cv_FR" as const;

/**
 * Long enough, and uneven enough, that chunking has something to get wrong: several
 * words, a run of spaces, a newline and a piece of punctuation the splitter must carry
 * through untouched.
 */
const content =
  'A CV in French, read once.\n  Its sections are: "Expérience", "Formation", "Langues" — and nothing was folded away.';

const recorded = {
  [cvFr]: {
    stands_for: "the person's own French CV",
    content,
    usage: { input_tokens: 1180, output_tokens: 62 },
  },
};

/** A streamed request, with an optional pace asked for the way a provider would ignore. */
const stream = (path: string, pace?: string) =>
  app.request(`/mock/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Jobapp-Case": cvFr,
      ...(pace === undefined ? {} : { "X-Jobapp-Mock-Pace": pace }),
    },
    body: JSON.stringify({ model: "m", messages: [], stream: true }),
  });

describe("the OpenAI stream", () => {
  it("is chunks of the case's own content, ended by the literal [DONE]", async () => {
    const cases = withCases(recorded);
    try {
      const frames = framesOf(await (await stream("/chat/completions", "tps=1000;chunk=1")).text());

      // Not JSON, and written out rather than remembered: a client that parses it as
      // JSON breaks, which is the thing this frame exists in the suite to pin.
      expect(frames.at(-1)).toEqual({ data: "[DONE]" });

      const chunks = frames.slice(0, -1).map((frame) => openAiChunk.parse(JSON.parse(frame.data)));
      expect(chunks[0]?.choices[0]?.delta).toEqual({ role: "assistant" });
      expect(chunks.at(-1)?.choices[0]).toMatchObject({ delta: {}, finish_reason: "stop" });
      expect(chunks.slice(0, -1).map((chunk) => chunk.choices[0]?.finish_reason)).toEqual(
        chunks.slice(0, -1).map(() => null),
      );
      expect(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("")).toBe(content);
      expect(chunks.length).toBeGreaterThan(3);
    } finally {
      cases.dispose();
    }
  });
});

describe("the Anthropic stream", () => {
  it("is named events from message_start to message_stop, with no sentinel at all", async () => {
    const cases = withCases(recorded);
    try {
      const body = await (await stream("/messages", "tps=1000;chunk=1")).text();
      const frames = framesOf(body);

      expect(body).not.toContain("[DONE]");
      expect(
        frames.map((frame) => frame.event).filter((name, at, all) => all[at - 1] !== name),
      ).toEqual([
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ]);

      const events = frames.map((frame) => anthropicEvent.parse(JSON.parse(frame.data)));
      // The event name on the wire and the type inside the data are the same word: a
      // client may read either, and a double that disagrees with itself teaches a bug.
      expect(events.map((event) => event.type)).toEqual(frames.map((frame) => frame.event));
      expect(
        events
          .filter((event) => event.type === "content_block_delta")
          .map((event) => event.delta.text)
          .join(""),
      ).toBe(content);
    } finally {
      cases.dispose();
    }
  });
});

/**
 * The pace, per request and by configuration. The suite's configured pace is zero on
 * all four settings, so nothing here waits; a test that wants a slow answer asks for
 * one in the header, which is why there is no second endpoint and no second code path.
 */
describe("the pace", () => {
  it("comes from configuration, which the suite sets to zero: one chunk, at once", async () => {
    const cases = withCases(recorded);
    try {
      const frames = framesOf(await (await stream("/chat/completions")).text());
      const chunks = frames.slice(0, -1).map((frame) => openAiChunk.parse(JSON.parse(frame.data)));

      expect(chunks.filter((chunk) => chunk.choices[0]?.delta.content !== undefined)).toHaveLength(
        1,
      );
    } finally {
      cases.dispose();
    }
  });

  it("is overridden per request by a header a real provider ignores", async () => {
    const cases = withCases(recorded);
    try {
      const frames = framesOf(await (await stream("/chat/completions", "tps=1000;chunk=2")).text());
      const pieces = frames
        .slice(0, -1)
        .map((frame) => openAiChunk.parse(JSON.parse(frame.data)))
        .filter((chunk) => chunk.choices[0]?.delta.content !== undefined);

      expect(pieces.length).toBeGreaterThan(1);
    } finally {
      cases.dispose();
    }
  });

  /**
   * The invariant, at every pace the four settings can be put in, including zero. The
   * pace moves the chunk boundaries and the clock; it never touches a character.
   */
  it.each([
    ["zero, the suite's own", "tps=0;ttft=0;chunk=0;jitter=0"],
    ["one token at a time", "tps=2000;ttft=0;chunk=1;jitter=0"],
    ["three at a time, jittered", "tps=2000;ttft=0;chunk=3;jitter=0.5"],
    ["a chunk larger than the answer", "tps=2000;ttft=0;chunk=500;jitter=0"],
  ])("joined, the pieces equal the whole answer at %s", async (_name, pace) => {
    const cases = withCases(recorded);
    try {
      const openAi = framesOf(await (await stream("/chat/completions", pace)).text())
        .slice(0, -1)
        .map((frame) => openAiChunk.parse(JSON.parse(frame.data)))
        .map((chunk) => chunk.choices[0]?.delta.content ?? "")
        .join("");
      const anthropic = framesOf(await (await stream("/messages", pace)).text())
        .map((frame) => anthropicEvent.parse(JSON.parse(frame.data)))
        .filter((event) => event.type === "content_block_delta")
        .map((event) => event.delta.text)
        .join("");

      expect(openAi).toBe(content);
      expect(anthropic).toBe(content);
    } finally {
      cases.dispose();
    }
  });
});
