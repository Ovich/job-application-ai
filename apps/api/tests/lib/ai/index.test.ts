import type { AIMessageChunk } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatModel } from "../../../src/lib/ai/client";
import {
  aiThroughTheApp,
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
const aboutNothingRecorded = { feature: "intake", step: "read", input: "never-recorded" };

const content = '{"kind":"cv","language":"fr","confidence":0.97}';

afterEach(() => {
  forgetRequests();
});

describe("a call through lib/ai", () => {
  it("carries the case header, set by the module and not by the caller", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    try {
      await aiThroughTheApp().ask([{ role: "user", content: "read this" }], aboutCvFr);
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
      await aiThroughTheApp().ask([{ role: "user", content: "read this" }], aboutCvFr);
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
      const answer = await aiThroughTheApp().ask(
        [{ role: "user", content: "read this" }],
        aboutCvFr,
      );

      expect(answer).toBe(content);
    } finally {
      cases.dispose();
    }
  });

  // A miss answers the mock's placeholder since `ID166`; the case asked for is named in
  // the mock's log rather than in the answer.
  it("throws on a case nobody recorded, naming the case asked for", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content, tool_calls: [] } });
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        aiThroughTheApp().ask([{ role: "user", content: "?" }], aboutNothingRecorded),
      ).resolves.toBe("No pre generated text");
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/intake\.read:never-recorded/);
    } finally {
      logged.mockRestore();
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
      for await (const piece of ai.askStreaming(
        [{ role: "user", content: "read this" }],
        aboutCvFr,
      )) {
        pieces.push(piece);
      }

      expect(pieces.join("")).toBe(long);
      expect(pieces.join("")).toBe(
        await ai.ask([{ role: "user", content: "read this" }], aboutCvFr),
      );
    } finally {
      cases.dispose();
    }
  });

  it("asks for the stream with the protocol's own field, and still nothing else", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content: long } });
    try {
      for await (const _ of aiThroughTheApp().askStreaming(
        [{ role: "user", content: "?" }],
        aboutCvFr,
      ));
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(Object.keys(sent?.body as object).sort()).toEqual(["messages", "model", "stream"]);
    expect(sent?.headers["x-jobapp-case"]).toBe(cvFr);
  });

  // A miss streams the mock's placeholder since `ID166`.
  it("throws on a case nobody recorded, before a single piece is yielded", async () => {
    const cases = withCases({ [cvFr]: { stands_for: "a CV", content: long } });
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pieces: string[] = [];
      for await (const piece of aiThroughTheApp().askStreaming(
        [{ role: "user", content: "?" }],
        aboutNothingRecorded,
      )) {
        pieces.push(piece);
      }
      expect(pieces.join("")).toBe("No pre generated text");
    } finally {
      logged.mockRestore();
      cases.dispose();
    }
  });
});

/**
 * `askWithTools`, as the agent loop meets it (`S4.1`, `S4.4`, `ID167`): the step's text
 * in pieces, then the step's calls, their arguments parsed. What is offered is a tool's
 * name, description and JSON schema, passed in: `lib/ai` knows no tool of the product.
 */
describe("askWithTools", () => {
  const step = "profile.message:conversation-1#1" as const;
  const aboutStep = { feature: "profile", step: "message", input: "conversation-1#1" };
  const edit = {
    itemId: "item-nexplore",
    operations: [{ op: "replace_line", lineId: "line-2", text: "Shipped the platform." }],
  };
  const tools = [
    {
      name: "edit_profile",
      description: "Change one item of the profile.",
      parameters: { type: "object", properties: { itemId: { type: "string" } } },
    },
  ];
  const said = "I shortened the second line, as you asked.";

  const drained = async (pieces: AsyncIterable<string>): Promise<string[]> => {
    const all: string[] = [];
    for await (const piece of pieces) all.push(piece);
    return all;
  };

  it("yields a text-only step's pieces, and settles on no calls", async () => {
    const cases = withCases({ [step]: { stands_for: "a reply", content: said } });
    try {
      const answer = aiThroughTheApp().askWithTools(
        [{ role: "user", content: "?" }],
        aboutStep,
        tools,
      );

      expect((await drained(answer.pieces)).join("")).toBe(said);
      expect(await answer.calls).toEqual([]);
    } finally {
      cases.dispose();
    }
  });

  it("yields the step's pieces, then settles on its call, the arguments parsed", async () => {
    const cases = withCases({
      [step]: {
        stands_for: "an edit",
        content: said,
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: edit }],
      },
    });
    try {
      const answer = aiThroughTheApp().askWithTools(
        [{ role: "user", content: "?" }],
        aboutStep,
        tools,
      );

      expect((await drained(answer.pieces)).join("")).toBe(said);
      // The parsed arguments, and the string exactly as it arrived (ID206).
      expect(await answer.calls).toEqual([
        {
          id: "call_1",
          name: "edit_profile",
          arguments: edit,
          argumentsText: JSON.stringify(edit),
        },
      ]);
    } finally {
      cases.dispose();
    }
  });

  it("asks with the protocol's own stream and tools, the model and the messages, and nothing else", async () => {
    const cases = withCases({ [step]: { stands_for: "a reply", content: said } });
    try {
      const answer = aiThroughTheApp().askWithTools(
        [{ role: "user", content: "?" }],
        aboutStep,
        tools,
      );
      await drained(answer.pieces);
      await answer.calls;
    } finally {
      cases.dispose();
    }

    const [sent] = requestsSent();
    expect(Object.keys(sent?.body as object).sort()).toEqual([
      "messages",
      "model",
      "stream",
      "tools",
    ]);
    expect(sent?.body).toMatchObject({
      model: "mock-model",
      stream: true,
      messages: [{ role: "user", content: "?" }],
      tools: [{ type: "function", function: tools[0] }],
    });
    expect(sent?.headers["x-jobapp-case"]).toBe(step);
  });

  it("rejects the calls, naming the case, when a call's arguments are not JSON", async () => {
    const cases = withCases({
      [step]: {
        stands_for: "a call the model botched",
        content: said,
        tool_calls: [{ id: "call_1", name: "edit_profile", arguments: '{"itemId": "item-nex' }],
      },
    });
    try {
      const answer = aiThroughTheApp().askWithTools(
        [{ role: "user", content: "?" }],
        aboutStep,
        tools,
      );
      await drained(answer.pieces);

      await expect(answer.calls).rejects.toThrow(/profile\.message:conversation-1#1/);
    } finally {
      cases.dispose();
    }
  });
});

/**
 * `chatModel()`, as the agent will meet it (D24, D27, D29): a `ChatOpenAI` on the same
 * configuration and fetch, streamed with the step's tools and the case header in the
 * call's own options. The same four facts `askWithTools` answers for, on the new client.
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
      const read = await aiThroughTheApp().askFor(
        [{ role: "user", content: "?" }],
        aboutCvFr,
        shape,
      );

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
        aiThroughTheApp().askFor([{ role: "user", content: "?" }], aboutCvFr, shape),
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
        aiThroughTheApp().askFor([{ role: "user", content: "?" }], aboutCvFr, shape),
      ).rejects.toThrow();
    } finally {
      cases.dispose();
    }
  });
});
