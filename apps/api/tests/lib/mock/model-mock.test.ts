import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as entry from "../../../src/lib/mock";
import { type Answer, ModelMock } from "../../../src/lib/mock";
import { anthropicWhole, framesOf, openAiWhole } from "../../support/envelopes";

/**
 * Seam: `ModelMock`, through its own `fetch`, with no application, no port and no
 * environment (`ID295`). What is under test is which answer a request gets (`ID292`), what
 * a test may give it and read back, and what a folder of answer files is held to. The wire
 * of each protocol is the other suites' (`answer`, `streaming`, `tool-calls`, `pace`).
 */

const java = 'I answered "Where did you write Java?" (Languages): Earlier work (before).';

const post = (
  model: ModelMock,
  path: string,
  body: object,
  headers: Record<string, string> = {},
): Promise<Response> =>
  model.fetch(
    new Request(`http://mock.test/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ model: "m", ...body }),
    }),
  );

/** What the OpenAI envelope says, whole. */
const saidTo = async (
  model: ModelMock,
  body: object,
  headers: Record<string, string> = {},
): Promise<string | null | undefined> =>
  openAiWhole.parse(await (await post(model, "/chat/completions", body, headers)).json()).choices[0]
    ?.message.content;

const userSays = (...texts: string[]) => ({
  messages: texts.map((content) => ({ role: "user", content })),
});

const quietly = () => vi.spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => vi.restoreAllMocks());

describe("the mock's only entry", () => {
  it("exports the class and nothing else at run time", () => {
    expect(Object.keys(entry)).toEqual(["ModelMock"]);
  });

  it("gives an instance the interface's members", () => {
    const model = new ModelMock([]);

    expect(
      (["chatCompletions", "messages", "fetch", "use", "reset"] as const).map(
        (name) => typeof model[name],
      ),
    ).toEqual(["function", "function", "function", "function", "function"]);
    expect(model.requests).toEqual([]);
  });
});

describe("which answer a request gets (ID292)", () => {
  const answers: Answer[] = [
    { case: "profile.message:one#1", content: "By the case." },
    { answers: java, content: "By the message." },
  ];

  it("is the case its header names, even when another answers the message", async () => {
    const model = new ModelMock(answers, { pace: "instant" });

    expect(await saidTo(model, userSays(java), { "x-mock-case": "profile.message:one#1" })).toBe(
      "By the case.",
    );
  });

  it("is the answer whose `answers` equals the last user message, when no held case is named", async () => {
    const model = new ModelMock(answers, { pace: "instant" });

    expect(await saidTo(model, userSays("Hello", java))).toBe("By the message.");
    expect(await saidTo(model, userSays(java), { "x-mock-case": "profile.message:other#1" })).toBe(
      "By the message.",
    );
  });

  it("reads the last user message past the assistant's and the tools' after it", async () => {
    const model = new ModelMock(answers, { pace: "instant" });

    expect(
      await saidTo(model, {
        messages: [
          { role: "system", content: "You are an assistant." },
          { role: "user", content: java },
          { role: "assistant", content: "One moment." },
        ],
      }),
    ).toBe("By the message.");
  });

  it("answers by the message on /messages too, its text blocks joined", async () => {
    const model = new ModelMock(answers, { pace: "instant" });
    const half = Math.floor(java.length / 2);

    const answer = await post(model, "/messages", {
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: java.slice(0, half) },
            { type: "text", text: java.slice(half) },
          ],
        },
      ],
    });

    const [block] = anthropicWhole.parse(await answer.json()).content;
    expect(block?.type === "text" ? block.text : undefined).toBe("By the message.");
  });

  it.each([
    ["one character off", userSays(`${java} `)],
    ["a part of it", userSays(java.slice(0, -1))],
    ["only an earlier user message matching", userSays(java, "And another thing.")],
    ["no message at all", { messages: [] }],
  ])("answers the placeholder with one warning line on %s", async (_name, body) => {
    const model = new ModelMock(answers, { pace: "instant" });
    const logged = quietly();

    expect(await saidTo(model, body)).toBe("No pre generated text");
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("never says the person's message in the warning, only the case", async () => {
    const model = new ModelMock(answers, { pace: "instant" });
    const logged = quietly();

    await saidTo(model, userSays("my own private words"), { "x-mock-case": "a.case:named" });

    expect(String(logged.mock.calls[0]?.[0])).toContain("a.case:named");
    expect(String(logged.mock.calls[0]?.[0])).not.toContain("my own private words");
  });

  it("reads the case in the header the options name", async () => {
    const model = new ModelMock(answers, { pace: "instant", caseHeader: "X-Product-Case" });

    expect(await saidTo(model, {}, { "x-product-case": "profile.message:one#1" })).toBe(
      "By the case.",
    );
  });
});

describe("fetch", () => {
  it("dispatches by the path's end to the handlers a route file binds", async () => {
    const model = new ModelMock([{ case: "a.b:c", content: "Same." }], { pace: "instant" });
    const asking = (url: string) =>
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-case": "a.b:c" },
        body: JSON.stringify({ model: "m", messages: [], max_tokens: 10 }),
      });

    const viaFetch = [
      await (await model.fetch(asking("http://anywhere.test/some/prefix/chat/completions"))).json(),
      await (await model.fetch(asking("http://anywhere.test/messages"))).json(),
    ];
    const viaHandlers = [
      await (await model.chatCompletions(asking("http://anywhere.test/x"))).json(),
      await (await model.messages(asking("http://anywhere.test/y"))).json(),
    ];

    expect(openAiWhole.parse(viaFetch[0]).choices[0]?.message.content).toBe("Same.");
    expect(openAiWhole.parse(viaHandlers[0]).choices[0]?.message.content).toBe("Same.");
    expect(anthropicWhole.parse(viaFetch[1]).content[0]).toEqual({ type: "text", text: "Same." });
    expect(anthropicWhole.parse(viaHandlers[1]).content[0]).toEqual({
      type: "text",
      text: "Same.",
    });
    expect(model.requests.map((each) => each.protocol)).toEqual([
      "openai-chat",
      "anthropic-messages",
      "openai-chat",
      "anthropic-messages",
    ]);
  });

  it("answers 404 on any other path, and logs no request", async () => {
    const model = new ModelMock([], { pace: "instant" });

    const answer = await post(model, "/embeddings", {});

    expect(answer.status).toBe(404);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(model.requests).toEqual([]);
  });
});

describe("the options", () => {
  it('answers a miss with a 404 JSON and no warning under onMiss "error"', async () => {
    const model = new ModelMock([], { pace: "instant", onMiss: "error" });
    const logged = quietly();

    const answer = await post(model, "/chat/completions", userSays("anything"), {
      "x-mock-case": "a.case:missing",
    });

    expect(answer.status).toBe(404);
    expect(JSON.stringify(await answer.json())).toContain("a.case:missing");
    expect(logged).not.toHaveBeenCalled();
    expect(model.requests.map((each) => each.picked)).toEqual([null]);
  });

  it("follows the request's own `stream` by default, and overrides it when told to", async () => {
    const answers: Answer[] = [{ answers: "Hi", content: "Hello there." }];
    const typeOf = async (options: ConstructorParameters<typeof ModelMock>[1], stream: boolean) =>
      (
        await post(new ModelMock(answers, { pace: "instant", ...options }), "/chat/completions", {
          ...userSays("Hi"),
          stream,
        })
      ).headers.get("content-type");

    expect(await typeOf({}, false)).toContain("application/json");
    expect(await typeOf({}, true)).toContain("text/event-stream");
    expect(await typeOf({ stream: "as-asked" }, true)).toContain("text/event-stream");
    expect(await typeOf({ stream: "always" }, false)).toContain("text/event-stream");
    expect(await typeOf({ stream: "never" }, true)).toContain("application/json");
  });

  it("takes the pace as the four settings, the spec string or `instant`, and the header over them", async () => {
    const content = "one two three four five six";
    const piecesAt = async (
      options: ConstructorParameters<typeof ModelMock>[1],
      headers: Record<string, string> = {},
    ) => {
      const model = new ModelMock([{ answers: "Hi", content }], options);
      const answer = await post(
        model,
        "/chat/completions",
        { ...userSays("Hi"), stream: true },
        headers,
      );
      return framesOf(await answer.text()).filter((frame) => frame.data.includes('"content"'))
        .length;
    };

    expect(await piecesAt({ pace: "instant" })).toBe(1);
    expect(await piecesAt({ pace: "tps=5000;ttft=0;chunk=1;jitter=0" })).toBe(11);
    expect(
      await piecesAt({
        pace: { tokensPerSecond: 5000, timeToFirstTokenMs: 0, tokensPerChunk: 500, jitter: 0 },
      }),
    ).toBe(1);
    expect(await piecesAt({ pace: "instant" }, { "x-mock-pace": "tps=5000;chunk=1" })).toBe(11);
    expect(
      await piecesAt(
        { pace: "instant", paceHeader: "X-Product-Pace" },
        { "x-product-pace": "tps=5000;chunk=1" },
      ),
    ).toBe(11);
  });
});

describe("a test's own answers and its evidence", () => {
  it("tries what `use` gave before the constructor's, and `reset` drops it", async () => {
    const model = new ModelMock(
      [
        { case: "a.b:c", content: "The constructor's, by case." },
        { answers: "Hi", content: "The constructor's, by message." },
      ],
      { pace: "instant" },
    );

    model.use(
      { case: "a.b:c", content: "The test's, by case." },
      { answers: "Hi", content: "The test's, by message." },
    );
    expect(await saidTo(model, {}, { "x-mock-case": "a.b:c" })).toBe("The test's, by case.");
    expect(await saidTo(model, userSays("Hi"))).toBe("The test's, by message.");

    model.use({ answers: "Hi", content: "The later one." });
    expect(await saidTo(model, userSays("Hi"))).toBe("The later one.");

    model.reset();
    expect(model.requests).toEqual([]);
    expect(await saidTo(model, {}, { "x-mock-case": "a.b:c" })).toBe("The constructor's, by case.");
    expect(await saidTo(model, userSays("Hi"))).toBe("The constructor's, by message.");
  });

  it("keeps every request in order: protocol, headers, body, last user message, what was picked", async () => {
    const model = new ModelMock(
      [
        { case: "a.b:c", content: "One." },
        { answers: "Hi", content: "Two." },
        { content: "Never." },
      ],
      { pace: "instant" },
    );
    quietly();

    await post(model, "/chat/completions", userSays("Hi"), { "x-mock-case": "a.b:c" });
    await post(model, "/messages", { ...userSays("Hi"), max_tokens: 5 });
    await post(model, "/chat/completions", userSays("Nobody wrote this"));

    expect(model.requests).toEqual([
      {
        protocol: "openai-chat",
        headers: expect.objectContaining({ "x-mock-case": "a.b:c" }),
        body: { model: "m", ...userSays("Hi") },
        lastUserMessage: "Hi",
        picked: "a.b:c",
      },
      {
        protocol: "anthropic-messages",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: { model: "m", ...userSays("Hi"), max_tokens: 5 },
        lastUserMessage: "Hi",
        // Inline and with no case, an answer's id is its index.
        picked: "1",
      },
      {
        protocol: "openai-chat",
        headers: expect.any(Object),
        body: { model: "m", ...userSays("Nobody wrote this") },
        lastUserMessage: "Nobody wrote this",
        picked: null,
      },
    ]);
  });

  it("refuses inline answers as it refuses files: no content, or two alike", () => {
    expect(() => new ModelMock([{ answers: "Hi" } as unknown as Answer])).toThrow(/answer 0/);
    expect(
      () =>
        new ModelMock([
          { case: "a.b:c", content: "One." },
          { case: "a.b:c", content: "Two." },
        ]),
    ).toThrow(/answer 0.*answer 1/);
    expect(() =>
      new ModelMock([]).use({ answers: "Hi", content: "One." }, { answers: "Hi", content: "Two." }),
    ).toThrow(/answer 0.*answer 1/);
  });
});

describe("a folder of answer files", () => {
  const folders: string[] = [];
  const folderOf = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "model-mock-"));
    folders.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    return root;
  };
  const asking = (model: ModelMock) => post(model, "/chat/completions", userSays("Hi"));

  afterEach(() => {
    for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("holds one answer per file, subfolders included, its id the case or the path", async () => {
    const model = new ModelMock(
      folderOf({
        "profile/greeting.json": JSON.stringify({ answers: "Hi", content: "Hello." }),
        "intake/deep/read__cv.json": JSON.stringify({ case: "intake.read:cv", content: "{}" }),
        "notes.txt": "not an answer, and not read",
      }),
      { pace: "instant" },
    );

    expect(await saidTo(model, userSays("Hi"))).toBe("Hello.");
    expect(await saidTo(model, {}, { "x-mock-case": "intake.read:cv" })).toBe("{}");
    expect(model.requests.map((each) => each.picked)).toEqual([
      "profile/greeting",
      "intake.read:cv",
    ]);
  });

  it("reads the folder on every request, so an edited file is the next answer", async () => {
    const root = folderOf({
      "greeting.json": JSON.stringify({ answers: "Hi", content: "Hello." }),
    });
    const model = new ModelMock(root, { pace: "instant" });

    expect(await saidTo(model, userSays("Hi"))).toBe("Hello.");
    writeFileSync(
      join(root, "greeting.json"),
      JSON.stringify({ answers: "Hi", content: "Again." }),
    );
    expect(await saidTo(model, userSays("Hi"))).toBe("Again.");
  });

  it("ignores the keys it does not know, and fills in what an answer leaves out", async () => {
    const model = new ModelMock(
      folderOf({
        "greeting.json": JSON.stringify({
          $schema: "./answer.schema.json",
          stands_for: "a greeting",
          note: "the author's own",
          answers: "Hi",
          content: "Hello.",
          tool_calls: [{ name: "wave", arguments: { hand: "left" } }],
        }),
      }),
      { pace: "instant" },
    );

    const body = openAiWhole.parse(await (await asking(model)).json());

    expect(body.choices[0]?.message.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "wave", arguments: '{"hand":"left"}' } },
    ]);
    expect(body.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it("holds nothing when the folder is not there", async () => {
    const model = new ModelMock(join(tmpdir(), "model-mock-no-such-folder"), { pace: "instant" });
    quietly();

    expect(await saidTo(model, userSays("Hi"))).toBe("No pre generated text");
  });

  it("throws naming the file that is not JSON, or has no content", async () => {
    const notJson = new ModelMock(folderOf({ "broken/half.json": '{"content": ' }));
    const noContent = new ModelMock(folderOf({ "empty/none.json": '{"answers": "Hi"}' }));

    await expect(asking(notJson)).rejects.toThrow(/half\.json.*not JSON/);
    await expect(asking(noContent)).rejects.toThrow(/none\.json.*content/);
  });

  it("throws naming both files when two have the same case, or the same `answers`", async () => {
    const sameCase = new ModelMock(
      folderOf({
        "one.json": JSON.stringify({ case: "a.b:c", content: "One." }),
        "sub/two.json": JSON.stringify({ case: "a.b:c", content: "Two." }),
      }),
    );
    const sameAnswers = new ModelMock(
      folderOf({
        "three.json": JSON.stringify({ answers: "Hi", content: "Three." }),
        "sub/four.json": JSON.stringify({ answers: "Hi", content: "Four." }),
      }),
    );

    await expect(asking(sameCase)).rejects.toThrow(/one\.json.*two\.json.*`case`/s);
    await expect(asking(sameAnswers)).rejects.toThrow(/four\.json.*three\.json.*`answers`/s);
  });
});
