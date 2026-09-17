import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Answer, ModelMock } from "../../../src/lib/mock";
import { anthropicWhole, framesOf, openAiChunk, openAiWhole } from "../../support/envelopes";

/**
 * Seam: `ModelMock.fetch`, answering a chain (D37, `ID302`), with inline answers and no
 * application. A chain is an answer whose call is answered by the caller and whose `next`
 * answers the next request: the mock finds the answer by the last user message (or the
 * case), then walks one `next` per assistant message of calls since that message, each
 * checked against the calls written at its link. What is read is what each request is
 * answered with, and the mock's own log of what it picked.
 */

const question = "What is the capital of Vaud?";

/** A request in OpenAI's shape: the user's message, then the steps so far. */
const openAi = (...after: object[]) => ({
  model: "m",
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: question },
    ...after,
  ],
});

/** An assistant message of calls, and the tool's answer to each, as OpenAI's client writes them. */
const called = (...calls: { id: string; name: string; arguments: string }[]) => [
  {
    role: "assistant",
    content: "",
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    })),
  },
  ...calls.map((call) => ({ role: "tool", tool_call_id: call.id, content: "{}" })),
];

const post = (model: ModelMock, path: string, body: object, headers: Record<string, string> = {}) =>
  model.fetch(
    new Request(`http://mock.test/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

/** What the OpenAI envelope answers, whole: the words and the calls' names and arguments. */
const answered = async (model: ModelMock, body: object, headers: Record<string, string> = {}) => {
  const said = openAiWhole.parse(
    await (await post(model, "/chat/completions", body, headers)).json(),
  ).choices[0]?.message;
  return {
    content: said?.content,
    calls: (said?.tool_calls ?? []).map((call) => [call.function.name, call.function.arguments]),
  };
};

const quietly = () => vi.spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => vi.restoreAllMocks());

const lookUp = { name: "look_up", arguments: { canton: "VD", country: "CH" } };

/**
 * An answer, and the link that answers the message after its calls. Every chain here is
 * written through this one function, so the key the answer files use is spelled once.
 */
const chained = <A extends object>(answer: A, next: object): A & { next: Answer } => ({
  ...answer,
  next: next as Answer,
});

const twoLinks: Answer = chained(
  { answers: question, tool_calls: [lookUp] },
  { content: "Lausanne." },
);

const threeLinks: Answer = chained(
  { answers: question, tool_calls: [lookUp] },
  chained(
    { content: "Checking the map as well.", tool_calls: [{ name: "map", arguments: {} }] },
    { content: "Lausanne, on the lake." },
  ),
);

describe("a chain of links (D37)", () => {
  it("answers the call first, then the words once the call was made", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });

    expect(await answered(model, openAi())).toEqual({
      content: "",
      calls: [["look_up", '{"canton":"VD","country":"CH"}']],
    });
    expect(
      await answered(
        model,
        openAi(
          ...called({ id: "call_1", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' }),
        ),
      ),
    ).toEqual({ content: "Lausanne.", calls: [] });
    expect(model.requests.map((each) => each.picked)).toEqual(["0", "0#next"]);
  });

  it("walks three links, one per message of calls", async () => {
    const model = new ModelMock([threeLinks], { pace: "instant" });
    const first = called({ id: "a", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' });
    const second = called({ id: "b", name: "map", arguments: "{}" });

    expect((await answered(model, openAi())).calls).toEqual([
      ["look_up", '{"canton":"VD","country":"CH"}'],
    ]);
    expect(await answered(model, openAi(...first))).toEqual({
      content: "Checking the map as well.",
      calls: [["map", "{}"]],
    });
    expect(await answered(model, openAi(...first, ...second))).toEqual({
      content: "Lausanne, on the lake.",
      calls: [],
    });
  });

  it("matches the arguments as values: key order and spacing are not the call", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });

    expect(
      (
        await answered(
          model,
          openAi(
            ...called({
              id: "x",
              name: "look_up",
              arguments: '{ "country": "CH",  "canton": "VD" }',
            }),
          ),
        )
      ).content,
    ).toBe("Lausanne.");
  });

  it("walks from the case its header names, as from a message", async () => {
    const model = new ModelMock(
      [chained({ case: "step", tool_calls: [lookUp] }, { content: "By the case." })],
      { pace: "instant" },
    );

    expect(
      (
        await answered(
          model,
          openAi(
            ...called({ id: "x", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' }),
          ),
          { "x-mock-case": "step" },
        )
      ).content,
    ).toBe("By the case.");
  });

  it("answers the next link streamed, as it answers any answer", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });
    const response = await post(model, "/chat/completions", {
      ...openAi(
        ...called({ id: "x", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' }),
      ),
      stream: true,
    });

    const said = framesOf(await response.text())
      .filter((frame) => frame.data !== "[DONE]")
      .map((frame) => openAiChunk.parse(JSON.parse(frame.data)).choices[0]?.delta.content ?? "")
      .join("");
    expect(said).toBe("Lausanne.");
  });

  it("walks Anthropic's messages too: tool_use blocks, and the results sent as a user message", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });

    const response = await post(model, "/messages", {
      model: "m",
      max_tokens: 100,
      messages: [
        { role: "user", content: question },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "look_up", input: lookUp.arguments }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{}" }],
        },
      ],
    });

    const [block] = anthropicWhole.parse(await response.json()).content;
    expect(block?.type === "text" ? block.text : undefined).toBe("Lausanne.");
    expect(model.requests.at(-1)?.lastUserMessage).toBe(question);
  });
});

describe("a chain that does not fit the calls made (D37)", () => {
  const placeholder = "No pre generated text";

  it.each([
    [
      "a call by another name",
      { id: "x", name: "look_down", arguments: '{"canton":"VD","country":"CH"}' },
    ],
    [
      "a call with other arguments",
      { id: "x", name: "look_up", arguments: '{"canton":"GE","country":"CH"}' },
    ],
    ["a call with fewer arguments", { id: "x", name: "look_up", arguments: '{"canton":"VD"}' }],
  ])("misses on %s: the placeholder, and the warning", async (_said, call) => {
    const model = new ModelMock([twoLinks], { pace: "instant" });
    const logged = quietly();

    expect((await answered(model, openAi(...called(call)))).content).toBe(placeholder);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(model.requests.at(-1)?.picked).toBeNull();
  });

  it("misses on more calls in one message than the link wrote", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });
    quietly();

    const two = called(
      { id: "x", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' },
      { id: "y", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' },
    );
    expect((await answered(model, openAi(...two))).content).toBe(placeholder);
  });

  it("misses once the chain has run out", async () => {
    const model = new ModelMock([twoLinks], { pace: "instant" });
    const logged = quietly();
    const call = { id: "x", name: "look_up", arguments: '{"canton":"VD","country":"CH"}' };

    expect((await answered(model, openAi(...called(call), ...called(call)))).content).toBe(
      placeholder,
    );
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("answers an answer without `next` as it always did, whatever came after the message", async () => {
    const model = new ModelMock([{ answers: question, content: "Lausanne." }], { pace: "instant" });
    const call = { id: "x", name: "anything", arguments: "{}" };

    expect((await answered(model, openAi(...called(call)))).content).toBe("Lausanne.");
  });
});

describe("what a chain is held to (ID302)", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const folderWith = (name: string, answer: unknown): string => {
    const root = mkdtempSync(join(tmpdir(), "model-mock-chain-"));
    folders.push(root);
    writeFileSync(join(root, name), JSON.stringify(answer), "utf8");
    return root;
  };

  it("fails the loader naming the file when a `next` sits under an answer with no tool_calls", async () => {
    const model = new ModelMock(
      folderWith(
        "nextless.json",
        chained({ answers: question, content: "Hm." }, { content: "No." }),
      ),
    );

    await expect(answered(model, openAi())).rejects.toThrow(/nextless\.json.*`next`.*tool_calls/);
  });

  it("fails the loader naming the file when a link has its own `answers` or `case`", async () => {
    const withAnswers = new ModelMock(
      folderWith(
        "named.json",
        chained({ answers: question, tool_calls: [lookUp] }, { answers: "Other.", content: "No." }),
      ),
    );
    const withCase = new ModelMock(
      folderWith(
        "cased.json",
        chained({ answers: question, tool_calls: [lookUp] }, { case: "other", content: "No." }),
      ),
    );

    await expect(answered(withAnswers, openAi())).rejects.toThrow(/named\.json.*`answers`/);
    await expect(answered(withCase, openAi())).rejects.toThrow(/cased\.json.*`case`/);
  });

  it("fails the loader naming the file when a link deep in the chain is not an answer", async () => {
    const model = new ModelMock(
      folderWith(
        "deep.json",
        chained(
          { answers: question, tool_calls: [lookUp] },
          chained({ tool_calls: [lookUp] }, chained({}, { content: "No." })),
        ),
      ),
    );

    await expect(answered(model, openAi())).rejects.toThrow(/deep\.json/);
  });

  it("takes an answer with tool_calls and no content, and refuses one with neither", () => {
    expect(() => new ModelMock([{ answers: question, tool_calls: [lookUp] }])).not.toThrow();
    expect(() => new ModelMock([{ answers: question }])).toThrow(/answer 0.*content/);
  });
});
