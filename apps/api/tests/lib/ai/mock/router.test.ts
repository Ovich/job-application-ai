import { describe, expect, it } from "vitest";
import { app } from "../../../../src/app";
import { casesHeld } from "../../../../src/lib/ai/mock";
import { withCases } from "../../../support/ai";
import { anthropicWhole, openAiWhole } from "../../../support/envelopes";

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

const cvFr = "intake.classify:2026-08-30_cv_FR" as const;
const content = '{"kind":"cv","language":"fr","confidence":0.97}';
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
 * A miss is a failure, never a call and never an invented answer (ID113). The body has
 * to say enough to fix it without opening the loader: the case that was asked for, and
 * the cases that are there.
 */
describe("a case nobody recorded", () => {
  it("answers 404, naming the case asked for and listing the cases held", async () => {
    const cases = withCases(recorded);
    try {
      const answer = await askFor(
        "/chat/completions",
        { model: "m", messages: [] },
        { "X-Jobapp-Case": "intake.classify:no-such-document" },
      );

      expect(answer.status).toBe(404);
      const body = (await answer.json()) as { error: string; case: string; held: string[] };
      expect(body.case).toBe("intake.classify:no-such-document");
      expect(body.held).toEqual([cvFr]);
      expect(body.error).toMatch(/intake\.classify:no-such-document/);
    } finally {
      cases.dispose();
    }
  });

  it("answers 404 when no case is named at all, rather than choosing one", async () => {
    const cases = withCases(recorded);
    try {
      const answer = await app.request("/mock/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });

      expect(answer.status).toBe(404);
      expect((await answer.json()) as { case: unknown }).toMatchObject({ case: null });
    } finally {
      cases.dispose();
    }
  });
});

/**
 * The cases the product ships with. Two, and each stands for a real document of the
 * person's own set (`cv-generic/2026-08-30_cv_FR.pdf` and its English counterpart),
 * which is what makes SL3's merge provable against something that exists.
 */
describe("the fixtures this slice ships", () => {
  it("holds the two CVs, named from the files themselves", () => {
    expect(casesHeld()).toEqual([
      "intake.classify:2026-08-30_cv_EN",
      "intake.classify:2026-08-30_cv_FR",
    ]);
  });
});
