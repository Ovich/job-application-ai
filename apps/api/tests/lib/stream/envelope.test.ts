import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame, Leaf } from "../../../src/lib/stream/envelope";
import {
  catalogueVersion,
  createEnvelope,
  heartbeatIntervalMs,
  leafSchema,
} from "../../../src/lib/stream/envelope";

/**
 * The envelope is what turns a leaf into a well-formed event stream: it validates the
 * leaf against the catalogue, numbers it, writes it as one server-sent event, and
 * keeps the connection from falling silent. Everything here is exercised through a
 * write sink the test owns, so no server, no socket and no database is involved
 * (ID13). Fixtures are obviously synthetic: no stream ever carries a person's data,
 * and neither does a test.
 */

/** Collects what the envelope wrote, in order, so a test can read the wire. */
const sink = () => {
  const chunks: string[] = [];
  return { chunks, write: (chunk: string) => void chunks.push(chunk) };
};

/** The fields of one server-sent event, as a browser would read them off the wire. */
const readEvent = (chunk: string) => {
  const lines = chunk.split("\n");
  return {
    id: lines
      .find((line) => line.startsWith("id:"))
      ?.slice("id:".length)
      .trim(),
    /** Every `data:` line, joined as the specification says a browser joins them. */
    data: lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n"),
    /** A line opening with a colon is a comment: it never reaches the page as data. */
    comments: lines.filter((line) => line.startsWith(":")),
  };
};

const someText: Leaf = { kind: "text", text: "reading the offer" };
const someMoreText: Leaf = { kind: "text", text: "and the next line of it" };

describe("the catalogue", () => {
  it("is versioned, so a frame written today still says which catalogue wrote it", () => {
    expect(Number.isInteger(catalogueVersion)).toBe(true);
    expect(catalogueVersion).toBeGreaterThanOrEqual(1);
  });

  /**
   * One leaf, since the `progress` leaf went with the run it reported on (SL10, D20).
   * The discriminator is still what does the work: an unknown kind is not a leaf at
   * all, whether the catalogue holds one shape or ten.
   */
  it("knows the leaf the foundation ships and nothing else", () => {
    expect(leafSchema.safeParse(someText).success).toBe(true);
    expect(leafSchema.safeParse({ kind: "sparkline", points: [1, 2] }).success).toBe(false);
  });

  it("refuses a known kind whose own shape is wrong", () => {
    // A known kind with a missing field is as wrong as an unknown kind.
    expect(leafSchema.safeParse({ kind: "text" }).success).toBe(false);
    expect(leafSchema.safeParse({ kind: "text", text: 42 }).success).toBe(false);
  });
});

describe("framing", () => {
  it("carries the leaf, the sequence it is stored under, and the catalogue version", async () => {
    const { chunks, write } = sink();
    const envelope = createEnvelope(write);

    const frame: Frame = await envelope.send(someText);

    expect(frame).toEqual({ seq: 1, version: catalogueVersion, leaf: someText });
    expect(chunks).toHaveLength(1);
  });

  it("numbers frames from one, ascending, whichever leaf they carry", async () => {
    const { write } = sink();
    const envelope = createEnvelope(write);

    const first = await envelope.send(someText);
    const second = await envelope.send(someMoreText);

    expect([first.seq, second.seq]).toEqual([1, 2]);
    // The sequence is the frame's position in the stream and belongs to the envelope:
    // a leaf never carries it and never chooses it.
    expect(second.leaf).toEqual(someMoreText);
  });

  it("resumes after the last sequence a browser saw, so a reconnect asks for the rest", async () => {
    const { write } = sink();
    const envelope = createEnvelope(write, { startAfter: 7 });

    const frame = await envelope.send(someText);

    expect(frame.seq).toBe(8);
  });

  it("writes each frame as one event whose id is the sequence", async () => {
    const { chunks, write } = sink();
    const envelope = createEnvelope(write);

    const frame = await envelope.send(someMoreText);

    const [chunk] = chunks;
    expect(chunk).toBeDefined();
    // A blank line terminates the event; without it a browser holds it in the buffer.
    expect(chunk?.endsWith("\n\n")).toBe(true);

    const event = readEvent(chunk ?? "");
    // The id is what a browser sends back as Last-Event-ID after a cut connection.
    expect(event.id).toBe(String(frame.seq));
    expect(JSON.parse(event.data)).toEqual(frame);
  });

  it("never frames a leaf the catalogue rejects, and does not spend a sequence on it", async () => {
    const { chunks, write } = sink();
    const envelope = createEnvelope(write);

    await expect(envelope.send({ kind: "sparkline", points: [1, 2] })).rejects.toThrow();
    await expect(envelope.send({ kind: "text", text: 42 })).rejects.toThrow();

    expect(chunks).toEqual([]);
    // The rejected leaves consumed nothing: the first leaf the catalogue accepts is 1.
    expect((await envelope.send(someText)).seq).toBe(1);
  });
});

describe("the heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("fires well inside the distribution's origin read timeout", () => {
    // The join at S3.7 is what proves this holds through the distribution; the
    // interval only has to leave room for it, which a 30 second timeout would not.
    expect(heartbeatIntervalMs).toBeGreaterThan(0);
    expect(heartbeatIntervalMs).toBeLessThan(30_000);
  });

  it("says something when the stream has been idle, so the connection is not silent", () => {
    const { chunks, write } = sink();
    createEnvelope(write);

    vi.advanceTimersByTime(heartbeatIntervalMs - 1);
    expect(chunks).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(chunks).toHaveLength(1);
  });

  it("beats as a comment carrying no leaf, so the page is never handed one as data", () => {
    const { chunks, write } = sink();
    createEnvelope(write);

    vi.advanceTimersByTime(heartbeatIntervalMs);

    const [beat] = chunks;
    const event = readEvent(beat ?? "");
    expect(event.comments.length).toBeGreaterThan(0);
    expect(event.data).toBe("");
    expect(event.id).toBeUndefined();
    expect(beat?.endsWith("\n\n")).toBe(true);
  });

  it("counts idleness from the last frame, not from the connection", async () => {
    const { chunks, write } = sink();
    const envelope = createEnvelope(write);

    vi.advanceTimersByTime(heartbeatIntervalMs - 1);
    await envelope.send(someText);
    vi.advanceTimersByTime(heartbeatIntervalMs - 1);

    // One chunk, the frame: a stream that is saying things needs no keep-alive.
    expect(chunks).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(chunks).toHaveLength(2);
  });

  it("stops beating once the stream is closed", () => {
    const { chunks, write } = sink();
    const envelope = createEnvelope(write);

    envelope.close();
    vi.advanceTimersByTime(heartbeatIntervalMs * 3);

    expect(chunks).toEqual([]);
  });
});
