import { describe, expect, it, vi } from "vitest";
import { app } from "../../../src/app";
import { casesHeld } from "../../../src/lib/mock";
import { withCases } from "../../support/ai";
import {
  anthropicEvent,
  anthropicWhole,
  framesOf,
  openAiChunk,
  openAiWhole,
} from "../../support/envelopes";

/**
 * Seam B: the mock's router, reached the way HTTP reaches it, through the application's
 * own handler. Behind it are the fixture files and nothing else; the fixtures' contents
 * are not tested here, because they are data.
 *
 * One case answers on both paths, and the two answers carry the same text in different
 * wrappers. That is the whole of decision D11: the difference between the protocols is
 * the envelope, so a fixture names no protocol and the day a provider is reached in
 * Anthropic's shape the recorded cases do not move.
 */

// A run over one of the person's own documents. The step is `read` and there is no
// other, because a run is one call now (`ID157`); what the content says is the router's
// business only in that it comes back byte for byte in either envelope.
const cvFr = "intake.read:2026-08-30_cv_FR" as const;
const content = '{"items":[],"candidates":[]}';
const recorded = {
  [cvFr]: {
    stands_for: "the person's own French CV",
    content,
    tool_calls: [],
    usage: { input_tokens: 1180, output_tokens: 62 },
  },
};

/** A request as a client of either protocol sends it: the case in the header, JSON in. */
const askFor = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/mock/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Jobapp-Case": cvFr, ...headers },
    body: JSON.stringify(body),
  });

describe("a recorded case, whole", () => {
  it("answers at /chat/completions in the OpenAI chat-completions envelope", async () => {
    const cases = withCases(recorded);
    try {
      const answer = await askFor("/chat/completions", { model: "m", messages: [] });

      expect(answer.status).toBe(200);
      const body = openAiWhole.parse(await answer.json());
      expect(body.choices[0]?.message.content).toBe(content);
      expect(body.usage).toEqual({
        prompt_tokens: 1180,
        completion_tokens: 62,
        total_tokens: 1242,
      });
    } finally {
      cases.dispose();
    }
  });

  it("answers the same case at /messages in Anthropic's envelope, with the same content", async () => {
    const cases = withCases(recorded);
    try {
      const openAi = openAiWhole.parse(
        await (await askFor("/chat/completions", { model: "m", messages: [] })).json(),
      );
      const anthropic = anthropicWhole.parse(
        await (await askFor("/messages", { model: "m", messages: [], max_tokens: 100 })).json(),
      );

      expect(anthropic.content[0]?.text).toBe(openAi.choices[0]?.message.content);
      expect(anthropic.usage).toEqual({ input_tokens: 1180, output_tokens: 62 });
    } finally {
      cases.dispose();
    }
  });
});

/**
 * A miss answers the placeholder `No pre generated text`, whole or streamed, in either
 * envelope (`ID166`, amending `ID113`): never a guess at another case, and never a call.
 * A structured call still fails on it, because the placeholder is not JSON. What the
 * answer no longer says, the log does: one line naming the case asked for (`ID198`).
 */
describe("a case nobody recorded (ID166)", () => {
  const placeholder = "No pre generated text";
  const missed = { "X-Jobapp-Case": "intake.read:no-such-document" };

  it("answers the placeholder in the OpenAI envelope, and logs the case asked for", async () => {
    const cases = withCases(recorded);
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const answer = await askFor("/chat/completions", { model: "m", messages: [] }, missed);

      expect(answer.status).toBe(200);
      const body = openAiWhole.parse(await answer.json());
      expect(body.choices[0]?.message.content).toBe(placeholder);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/intake\.read:no-such-document/);
    } finally {
      logged.mockRestore();
      cases.dispose();
    }
  });

  it("answers the placeholder when no case is named at all, rather than choosing one", async () => {
    const cases = withCases(recorded);
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const answer = await app.request("/mock/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });

      expect(answer.status).toBe(200);
      expect(openAiWhole.parse(await answer.json()).choices[0]?.message.content).toBe(placeholder);
    } finally {
      logged.mockRestore();
      cases.dispose();
    }
  });

  it("answers the placeholder in Anthropic's envelope", async () => {
    const cases = withCases(recorded);
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const answer = await askFor(
        "/messages",
        { model: "m", messages: [], max_tokens: 100 },
        missed,
      );

      expect(answer.status).toBe(200);
      expect(anthropicWhole.parse(await answer.json()).content[0]?.text).toBe(placeholder);
    } finally {
      logged.mockRestore();
      cases.dispose();
    }
  });

  it("streams the placeholder in both envelopes, the pieces joined equal to it", async () => {
    const cases = withCases(recorded);
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const streamed = { "X-Jobapp-Mock-Pace": "tps=1000;chunk=1", ...missed };
      const openAi = await askFor(
        "/chat/completions",
        { model: "m", messages: [], stream: true },
        streamed,
      );
      const anthropic = await askFor(
        "/messages",
        { model: "m", messages: [], max_tokens: 100, stream: true },
        streamed,
      );

      expect(openAi.status).toBe(200);
      expect(anthropic.status).toBe(200);
      const chunks = framesOf(await openAi.text());
      expect(chunks.at(-1)).toEqual({ data: "[DONE]" });
      expect(
        chunks
          .slice(0, -1)
          .map((frame) => openAiChunk.parse(JSON.parse(frame.data)).choices[0]?.delta.content ?? "")
          .join(""),
      ).toBe(placeholder);
      expect(
        framesOf(await anthropic.text())
          .map((frame) => anthropicEvent.parse(JSON.parse(frame.data)))
          .filter((event) => event.type === "content_block_delta")
          .map((event) => (event.delta.type === "text_delta" ? event.delta.text : ""))
          .join(""),
      ).toBe(placeholder);
    } finally {
      logged.mockRestore();
      cases.dispose();
    }
  });
});

/**
 * The cases the product ships with. Each stands for real documents of the person's own
 * set and is named from those files, which is what makes the reading provable against
 * something that exists (`D20`).
 *
 * **One case per run, not per document** (`ID157`, `ID158`). The reading joins a run's
 * documents into one composed document and answers with the whole profile and the
 * questions it leaves open, in a single call, so what is shipped is one answer per
 * combination a run actually makes — named by every document of that run, by slug, in
 * the run's order. The `classify`, `extract`, `merge` and `questions` cases went with
 * the steps that asked for them: a recorded answer for a call nobody makes any more is
 * a fixture nothing proves.
 *
 * There is no LinkedIn export case and no photograph case, and that is not an omission:
 * the person's set holds neither document, and a canned answer standing for no real file
 * is exactly what `D20` forbids.
 */
describe("the fixtures this slice ships", () => {
  it("holds one case per run of the person's real documents, named from those files", () => {
    expect(casesHeld()).toEqual([
      // One document alone, and then the combinations the suite drives a run over.
      "intake.read:2026-08-30_cv_EN",
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR",
      "intake.read:2026-08-30_cv_FR",
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN",
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome",
      "intake.read:2026-08-30_cv_FR+leCVWeb+CV-2025",
      "intake.read:leCVWeb+CV-2025",
    ]);
  });

  it("holds no LinkedIn export case, because there is no such document to stand for", () => {
    expect(casesHeld().filter((name) => /linkedin|export|photo/i.test(name))).toEqual([]);
  });
});
