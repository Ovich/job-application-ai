import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { aiThroughTheApp, forgetRequests, requestsSent, withCases } from "../../support/ai";

/**
 * Seam A: `lib/ai`, its call helpers, as a pipeline step meets them.
 *
 * Behind the seam is the official client over HTTP; in the suite the same client is
 * handed a fetch that dispatches into this application's own handler, so the mock
 * answers in-process and no port is opened. The client's transport is not tested here:
 * it is a dependency, not ours.
 *
 * What is tested is the boundary's whole promise. A call names a case and the module
 * puts that name on the wire; the request carries nothing a real provider would reject;
 * a recorded case comes back as its content; a case nobody recorded throws with its own
 * name in the message rather than returning something invented.
 */

const cvFr = "intake.classify:2026-08-30_cv_FR" as const;
const content = '{"kind":"cv","language":"fr","confidence":0.97}';

afterEach(() => {
  forgetRequests();
});

describe("a call through lib/ai", () => {
  it("carries the case header, set by the module and not by the caller", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      await aiThroughTheApp().ask(cvFr, [{ role: "user", content: "read this" }]);
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(sent?.headers["x-jobapp-case"]).toBe(cvFr);
  });

  /**
   * Criterion 3, and the forbidden edge it defends: `lib/ai` holds no provider branch,
   * so the body it sends is the protocol's own fields and nothing else. A field only
   * the double would understand is exactly what would make a real run diverge from a
   * mocked one, and it would be found in production rather than here.
   */
  it("sends a body of protocol fields only, nothing a provider would reject", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      await aiThroughTheApp().ask(cvFr, [{ role: "user", content: "read this" }]);
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(Object.keys(sent?.body as object).sort()).toEqual(["messages", "model"]);
    expect(sent?.body).toMatchObject({
      model: "mock-model",
      messages: [{ role: "user", content: "read this" }],
    });
  });

  it("answers a recorded case with that case's content", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      const answer = await aiThroughTheApp().ask(cvFr, [{ role: "user", content: "read this" }]);

      expect(answer).toBe(content);
    } finally {
      cases.dispose();
    }
  });

  it("throws on a case nobody recorded, naming the case asked for", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      await expect(
        aiThroughTheApp().ask("intake.classify:never-recorded", [{ role: "user", content: "?" }]),
      ).rejects.toThrow(/intake\.classify:never-recorded/);
    } finally {
      cases.dispose();
    }
  });
});

/**
 * Streaming, as a step meets it: an async iterable of pieces. That it is the protocol's
 * own `stream: true` and not an endpoint of ours is what makes the same code work
 * against the double and against a provider, so the only thing asserted here is what a
 * caller sees — more than one piece, and the same answer as the whole one.
 */
describe("askStreaming", () => {
  const long = "A CV in French, read once. Nothing was folded away and nothing was inferred.";

  it("yields the recorded content in pieces that join to the whole answer", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content: long } });
    try {
      const ai = aiThroughTheApp();
      const pieces: string[] = [];
      for await (const piece of ai.askStreaming(cvFr, [{ role: "user", content: "read this" }])) {
        pieces.push(piece);
      }

      expect(pieces.join("")).toBe(long);
      expect(pieces.join("")).toBe(await ai.ask(cvFr, [{ role: "user", content: "read this" }]));
    } finally {
      cases.dispose();
    }
  });

  it("asks for the stream with the protocol's own field, and still nothing else", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content: long } });
    try {
      for await (const _ of aiThroughTheApp().askStreaming(cvFr, [{ role: "user", content: "?" }]));
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(Object.keys(sent?.body as object).sort()).toEqual(["messages", "model", "stream"]);
    expect(sent?.headers["x-jobapp-case"]).toBe(cvFr);
  });

  it("throws on a case nobody recorded, before a single piece is yielded", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content: long } });
    try {
      await expect(async () => {
        for await (const _ of aiThroughTheApp().askStreaming("intake.classify:never-recorded", [
          { role: "user", content: "?" },
        ]));
      }).rejects.toThrow(/intake\.classify:never-recorded/);
    } finally {
      cases.dispose();
    }
  });
});

/**
 * `askFor` exists because every later step wants a shape, not prose. It validates and
 * throws, which is what keeps a half-valid object out of the database: a caller either
 * gets the shape it asked for or an error, never something in between.
 */
describe("askFor", () => {
  const shape = z.object({ kind: z.string(), language: z.string() });

  it("parses the answer into the shape asked for", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      const read = await aiThroughTheApp().askFor(cvFr, [{ role: "user", content: "?" }], shape);

      expect(read).toEqual({ kind: "cv", language: "fr" });
    } finally {
      cases.dispose();
    }
  });

  it("throws rather than return half of a shape the answer does not have", async () => {
    const cases = withCases({
      [cvFr]: { stands_for: "a CV", content: '{"kind":"cv"}', tool_calls: [] },
    });
    try {
      await expect(
        aiThroughTheApp().askFor(cvFr, [{ role: "user", content: "?" }], shape),
      ).rejects.toThrow();
    } finally {
      cases.dispose();
    }
  });

  it("throws when the answer is not JSON at all", async () => {
    const cases = withCases({
      [cvFr]: { stands_for: "a CV", content: "not json", tool_calls: [] },
    });
    try {
      await expect(
        aiThroughTheApp().askFor(cvFr, [{ role: "user", content: "?" }], shape),
      ).rejects.toThrow();
    } finally {
      cases.dispose();
    }
  });
});
