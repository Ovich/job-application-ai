import { describe, expect, it } from "vitest";
// The library's own suite reads the pace below its entry: the spec string and the chunking
// are what both envelopes rest on, and the entry exports the class and its types alone.
import { chunksOf, defaultPace, paceFrom, paceOf } from "../../../src/lib/mock/pace";

/**
 * The four named settings, read from a value that configuration and the per-request
 * header spell exactly alike, so the default and the exception are the same sentence.
 */
describe("a pace read from its four names", () => {
  it("is the defaults the spec names when nothing says otherwise", () => {
    expect(defaultPace).toEqual({
      tokensPerSecond: 40,
      timeToFirstTokenMs: 400,
      tokensPerChunk: 3,
      jitter: 0.15,
    });
  });

  it("takes all four when all four are given", () => {
    expect(paceFrom("tps=8;ttft=1500;chunk=1;jitter=0", defaultPace)).toEqual({
      tokensPerSecond: 8,
      timeToFirstTokenMs: 1500,
      tokensPerChunk: 1,
      jitter: 0,
    });
  });

  it("overrides only what it mentions, so a partial spec is a partial exception", () => {
    expect(paceFrom("ttft=1500", defaultPace)).toEqual({
      ...defaultPace,
      timeToFirstTokenMs: 1500,
    });
  });

  it("ignores a key it does not know and a value that is not a number", () => {
    expect(paceFrom("nonsense=9;tps=abc;chunk=2", defaultPace)).toEqual({
      ...defaultPace,
      tokensPerChunk: 2,
    });
  });

  it("falls back whole when nothing is asked for", () => {
    expect(paceOf(new Headers(), "x-mock-pace", defaultPace)).toEqual(defaultPace);
  });

  it("reads the request's own header when it carries one", () => {
    expect(paceOf(new Headers({ "x-mock-pace": "tps=0" }), "x-mock-pace", defaultPace)).toEqual({
      ...defaultPace,
      tokensPerSecond: 0,
    });
  });
});

/**
 * The chunking, at the level below the wire. The mock's own tests prove the envelopes;
 * this proves the one thing both envelopes rest on, and proves it on the awkward
 * content — runs of spaces, a newline, an empty answer — that a split-and-join gets
 * wrong quietly.
 */
describe("the pieces a recorded answer is split into", () => {
  const content = "one  two\nthree   four five";

  it("is the whole answer in one piece at zero tokens per second", () => {
    expect(chunksOf(content, { ...defaultPace, tokensPerSecond: 0 })).toEqual([content]);
  });

  it.each([1, 2, 3, 500])("joins back to the answer exactly, at %i tokens a chunk", (size) => {
    const chunks = chunksOf(content, { ...defaultPace, tokensPerChunk: size });

    expect(chunks.join("")).toBe(content);
  });

  it("is more than one piece when the pace asks for more than one", () => {
    expect(chunksOf(content, { ...defaultPace, tokensPerChunk: 1 }).length).toBeGreaterThan(1);
  });

  it("is nothing at all for an empty answer, rather than one empty piece", () => {
    expect(chunksOf("", defaultPace)).toEqual([]);
  });
});
