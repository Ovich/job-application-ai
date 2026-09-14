import { describe, expect, it } from "vitest";
import { framesOf, type StreamFrame } from "../../../src/app/lib/stream";

/**
 * Seam C: `app/lib/stream`, `framesOf(body)` (agent-consolidation `SL3`, `ID184`).
 *
 * Behind it: a body built here, chunk by chunk, the way a network hands one over. What is
 * read is the frames it yields.
 *
 * Not past it: the documents screen's own loop, which this slice leaves alone.
 */

const encoder = new TextEncoder();

const bodyOf = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

const every = async (body: ReadableStream<Uint8Array>): Promise<StreamFrame[]> => {
  const read: StreamFrame[] = [];
  for await (const frame of framesOf(body)) read.push(frame);
  return read;
};

/** A frame as the API's envelope writes it. */
const wire = (seq: number, leaf: unknown): string =>
  `id: ${seq}\ndata: ${JSON.stringify({ seq, version: 1, leaf })}\n\n`;

describe("framesOf", () => {
  it("yields a frame split across two chunks once, whole", async () => {
    const one = wire(1, { kind: "text", text: "No pre generated text" });

    const frames = await every(bodyOf([one.slice(0, 20), one.slice(20)]));

    expect(frames).toEqual([
      { seq: 1, version: 1, leaf: { kind: "text", text: "No pre generated text" } },
    ]);
  });

  it("yields two frames that arrive in one chunk, both, in order", async () => {
    const frames = await every(
      bodyOf([wire(1, { kind: "text", text: "No pre" }) + wire(2, { kind: "done" })]),
    );

    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(frames[1]?.leaf).toEqual({ kind: "done" });
  });

  it("yields nothing for a heartbeat", async () => {
    const frames = await every(bodyOf([": beat\n\n", wire(1, { kind: "done" })]));

    expect(frames).toEqual([{ seq: 1, version: 1, leaf: { kind: "done" } }]);
  });

  it("skips a data line that is not JSON, and still reads the next", async () => {
    const frames = await every(bodyOf(["data: [DONE]\n\n", wire(2, { kind: "done" })]));

    expect(frames).toEqual([{ seq: 2, version: 1, leaf: { kind: "done" } }]);
  });
});
