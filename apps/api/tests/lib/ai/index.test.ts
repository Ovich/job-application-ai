import { type AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatModel } from "../../../src/lib/ai/client";
import {
  askForThroughTheApp,
  chatModelThroughTheApp,
  forgetRequests,
  recordingFetch,
  requestsSent,
  withCases,
} from "../../support/ai";

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

const cvFr = "intake.read:2026-08-30_cv_FR" as const;

/**
 * What the call is about, in the three strings `lib/ai` now takes (`ID145`), and the
 * case name the double files its answer under — which is what those three strings
 * serialise to on the wire. They are the same value written twice, deliberately: the
 * test says the case out loud so that what the header carries is asserted against a
 * literal rather than against the client's own arithmetic.
 */
const aboutCvFr = { feature: "intake", step: "read", input: "2026-08-30_cv_FR" };

const content = '{"kind":"cv","language":"fr","confidence":0.97}';

afterEach(() => {
  forgetRequests();
});

/**
 * `chatModel()`, as the agent will meet it (D24, D27, D29): a `ChatOpenAI` on the same
 * configuration and fetch, streamed with the step's tools and the case header in the
 * call's own options.
 */
describe("chatModel", () => {
  const step = "profile.message:conversation-1#1" as const;
  const edit = {
    itemId: "item-nexplore",
    operations: [{ op: "replace_line", lineId: "line-2", text: "Shipped the platform." }],
  };
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "edit_profile",
        description: "Change one item of the profile.",
        parameters: { type: "object", properties: { itemId: { type: "string" } } },
      },
    },
  ];
  const said = "I shortened the second line, as you asked, and nothing else moved.";

  /**
   * One streamed call: the case in the call's own headers. On the streamed path the
   * class hands the whole call options to the SDK as its request options
   * (`chat_models/completions.js:188,257`), so the headers go at their top level; a
   * nested `options.headers` reaches the wire only on the unstreamed path (`:107`).
   * The call options' type does not name the field, hence the variable.
   */
  const streamed = async (headers: Record<string, string> = {}) => {
    const chunks: AIMessageChunk[] = [];
    const callOptions = { tools, headers: { "X-Jobapp-Case": step, ...headers } };
    const stream = await chatModelThroughTheApp().stream(
      [{ role: "user", content: "?" }],
      callOptions,
    );
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  };

  const merged = (chunks: AIMessageChunk[]): AIMessageChunk => {
    const [first, ...rest] = chunks;
    if (first === undefined) throw new Error("the stream yielded nothing");
    return rest.reduce((all, chunk) => all.concat(chunk), first);
  };

  it("carries the case header the call's options set", async () => {
    const cases = withCases({ [step]: { stands_for: "a reply", content: said } });
    try {
      await streamed();
    } finally {
      cases.dispose();
    }

    expect(requestsSent()).toHaveLength(1);
    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBe(step);
  });

  it("sends the protocol fields of the spec's 3.2 table and nothing else", async () => {
    const cases = withCases({ [step]: { stands_for: "a reply", content: said } });
    try {
      await streamed();
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(Object.keys(sent?.body as object).sort()).toEqual([
      "messages",
      "model",
      "stream",
      "stream_options",
      "tools",
    ]);
    expect(sent?.body).toEqual({
      model: "mock-model",
      messages: [{ role: "user", content: "?" }],
      stream: true,
      stream_options: { include_usage: true },
      tools,
    });
  });

  it("yields the recorded content in pieces, then the call with its arguments parsed", async () => {
    const cases = withCases({
      [step]: {
        stands_for: "an edit",
        content: said,
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: edit }],
        usage: { input_tokens: 90, output_tokens: 12 },
      },
    });
    let chunks: AIMessageChunk[];
    try {
      chunks = await streamed({ "X-Jobapp-Mock-Pace": "tps=1000;chunk=1" });
    } finally {
      cases.dispose();
    }

    const pieces = chunks.filter((chunk) => chunk.content !== "");
    const lastPiece = chunks.lastIndexOf(pieces.at(-1) as AIMessageChunk);
    const firstCall = chunks.findIndex((chunk) => (chunk.tool_call_chunks ?? []).length > 0);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((chunk) => chunk.content).join("")).toBe(said);
    expect(firstCall).toBeGreaterThan(lastPiece);

    const message = merged(chunks);
    expect(message.content).toBe(said);
    expect(message.tool_calls).toEqual([
      { id: "call_1", name: "edit_profile", args: edit, type: "tool_call" },
    ]);
    expect(message.invalid_tool_calls ?? []).toEqual([]);
    // The usage chunk the body asked for, read back by the class (D29).
    expect(message.usage_metadata).toMatchObject({
      input_tokens: 90,
      output_tokens: 12,
      total_tokens: 102,
    });
  });

  // `ChatOpenAI` does not reject such a call: it files it under `invalid_tool_calls`,
  // and the agent's step fails on it (spec 7). Arguments cut short are another matter:
  // the streamed chunks are parsed as partial JSON and come back as a call.
  it("files a call whose arguments are not JSON as invalid, on the case's request", async () => {
    const botched = '{"itemId": item-nex}';
    const cases = withCases({
      [step]: {
        stands_for: "a call the model botched",
        content: said,
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: botched }],
      },
    });
    let chunks: AIMessageChunk[];
    try {
      chunks = await streamed();
    } finally {
      cases.dispose();
    }

    const message = merged(chunks);
    expect(message.tool_calls ?? []).toEqual([]);
    expect(message.invalid_tool_calls).toEqual([
      expect.objectContaining({ id: "call_1", name: "edit_profile", args: botched }),
    ]);
    expect(requestsSent()[0]?.headers["x-jobapp-case"]).toBe(step);
  });

  // A model name the library would send to the Responses API (`ID281`): the class keeps
  // it on chat completions, the one path the mock and every compatible endpoint serve.
  it("keeps a model name ChatOpenAI would route away on the chat-completions path", async () => {
    const cases = withCases({ [step]: { stands_for: "a reply", content: said } });
    const urls: string[] = [];
    const model = createChatModel({
      baseUrl: "http://api.test/mock/v1",
      apiKey: "the-mock-ignores-this",
      model: "gpt-5.2-pro",
      fetch: (input, init) => {
        urls.push(new Request(input, init).url);
        return recordingFetch(input, init);
      },
    });
    let answer: AIMessageChunk | undefined;
    try {
      // The call options' type does not name the field (see `streamed`).
      const callOptions = { headers: { "X-Jobapp-Case": step } } as Parameters<
        typeof model.stream
      >[1];
      for await (const chunk of await model.stream([{ role: "user", content: "?" }], callOptions)) {
        answer = answer === undefined ? chunk : answer.concat(chunk);
      }
    } finally {
      cases.dispose();
    }

    expect(urls).toEqual(["http://api.test/mock/v1/chat/completions"]);
    expect(requestsSent()[0]?.body).toMatchObject({ model: "gpt-5.2-pro", stream: true });
    expect(answer?.content).toBe(said);
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
      const read = await askForThroughTheApp()([new HumanMessage("?")], aboutCvFr, shape);

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
        askForThroughTheApp()([new HumanMessage("?")], aboutCvFr, shape),
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
        askForThroughTheApp()([new HumanMessage("?")], aboutCvFr, shape),
      ).rejects.toThrow();
    } finally {
      cases.dispose();
    }
  });
});
