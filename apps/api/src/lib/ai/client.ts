import { ChatOpenAICompletions } from "@langchain/openai";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ZodType } from "zod";

/**
 * The one AI client (ID107, ID108, ID145).
 *
 * The official `openai` package, pointed at a base URL configuration decides, and no
 * wrapper of our own around the transport: the wire shape *is* the abstraction. OpenAI,
 * Azure, a self-hosted vLLM and Anthropic's OpenAI-compatible endpoint are then one
 * integration, and the only difference between one environment and another is the value
 * of `AI_BASE_URL`.
 *
 * **It knows nothing about what is on the other side, and that is the whole rule**
 * (`S7.1`, criterion 2, `ID145`; the person asked for a pure client that ignores what is
 * answering it, and their sentence is quoted in full where the rule is enforced,
 * `tests/lib/ai/boundary.test.ts`). What this module hides from a pipeline step is the
 * client's construction, the base URL, the key, the model, the transport and the
 * difference between a streamed answer and a whole one. What it must never hold is a
 * branch on who answers — nor a type, a name or a comment that exists because one
 * particular answerer does. That test greps these sources for such vocabulary and fails
 * on a word of it.
 *
 * It reads no environment. Its configuration arrives as values, from `env.ts`, which is
 * the one reader — and from a caller that hands it a `fetch` of its own, which is how the
 * suite answers in-process with no port open and how the deployed function answers itself
 * with no network hop (`ID130`, `ID150`).
 */

/** Everything the client needs, as values. */
export type AiConfig = {
  /** Ends at the `/v1`-equivalent: the client appends `/chat/completions` itself. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * How a request is put on the wire. The default is the platform's `fetch`, and a
   * caller passes its own when the answer is to be produced in this same process
   * rather than over a socket (`ID130`, `ID150`).
   */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

/**
 * One turn of the conversation, in the library's own type rather than in one of ours
 * (`S7.1`, criterion 3; the person's own comment: *"Dont the lib provide builtin
 * types?"*). Re-declaring it would be a second definition to keep in step with the
 * package this module already depends on, and the first field the library added and we
 * did not would be found at a call site rather than here.
 */
export type Message = ChatCompletionMessageParam;

/**
 * What a call is about: which feature, which step of it, and which input it is working
 * on — for instance `intake`, `classify`, `2026-08-30_cv_FR` (`ID145`, amending
 * `ID111`).
 *
 * It is the product's own request metadata, the thing any product attaches to a model
 * call so a trace and a bill can be read back to the work that caused them. The client
 * serialises it into one request header and has no opinion about who reads it: a
 * provider ignores a header it does not know, and whatever else is on the other side is
 * none of this module's business.
 */
export type About = { feature: string; step: string; input: string };

/**
 * One tool a call may offer the model: its name, what it does, and the JSON schema of its
 * input (`ID167`). The schema is passed in, already derived, so this module holds no
 * tool of the product and no schema library's opinion of one.
 */
export type Tool = { name: string; description: string; parameters: object };

/**
 * One call the model made: its arguments parsed from the protocol's string, and that
 * string exactly as it arrived (`ID206`), so a later call can hand the model back what it
 * wrote, byte for byte.
 */
export type ToolCall = { id: string; name: string; arguments: unknown; argumentsText: string };

/**
 * One step of an answer that may call tools: its text as it arrives, and its calls.
 * `calls` settles once `pieces` is drained, and not before: the calls end the stream.
 */
export type Step = { pieces: AsyncIterable<string>; calls: Promise<ToolCall[]> };

/** The four ways a caller asks. Nothing else is exposed. */
export type Ai = {
  ask: (messages: Message[], about: About) => Promise<string>;
  askStreaming: (messages: Message[], about: About) => AsyncIterable<string>;
  askFor: <T>(messages: Message[], about: About, shape: ZodType<T>) => Promise<T>;
  askWithTools: (messages: Message[], about: About, tools: Tool[]) => Step;
};

/**
 * The header the metadata travels in, and the one spelling of it. Its name is part of
 * the request rather than a name in this module's vocabulary, which is why it survives
 * verbatim: changing it would change the wire.
 */
const aboutHeader = "X-Jobapp-Case";

/** The one serialisation, so a trace, a log line and a bill all read the same string. */
const tagOf = (about: About): string => `${about.feature}.${about.step}:${about.input}`;

/**
 * Every failure comes back naming what the call was about. The underlying error is kept
 * as the cause, and the tag is the one thing a person reading the failure needs in order
 * to find the work it belongs to.
 */
const failure = (about: About, cause: unknown): Error =>
  new Error(
    `The AI call about ${tagOf(about)} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );

const named = async <T>(about: About, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (cause) {
    throw failure(about, cause);
  }
};

export const createAi = (config: AiConfig): Ai => {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
  });

  /**
   * The request, and the whole of criterion 3: the model, the messages, and — when the
   * caller wants pieces — the protocol's own `stream`. Nothing else. The metadata
   * travels as a header, set here and never by a caller, so no step can forget it and no
   * body carries a field a provider would reject.
   */
  const options = (about: About) => ({ headers: { [aboutHeader]: tagOf(about) } });

  const ask = (messages: Message[], about: About): Promise<string> =>
    named(about, async () => {
      const answer = await client.chat.completions.create(
        { model: config.model, messages },
        options(about),
      );
      const content = answer.choices[0]?.message.content;
      if (typeof content !== "string") throw new Error("the answer carried no content");
      return content;
    });

  async function* askStreaming(messages: Message[], about: About): AsyncIterable<string> {
    const pieces = await named(about, () =>
      client.chat.completions.create(
        { model: config.model, messages, stream: true },
        options(about),
      ),
    );
    for await (const piece of pieces) {
      const text = piece.choices[0]?.delta.content;
      if (typeof text === "string" && text !== "") yield text;
    }
  }

  /**
   * Every later step wants a shape, not prose, and this is what keeps a bad answer out
   * of the database: the answer is parsed and validated before it reaches a caller, so
   * there is no half-valid object to return (spec, *Failure modes*).
   */
  const askFor = async <T>(messages: Message[], about: About, shape: ZodType<T>): Promise<T> => {
    const answer = await ask(messages, about);
    return named(about, async () => shape.parse(JSON.parse(answer)));
  };

  /**
   * A step that may call tools (`ID167`): the protocol's own `tools` and `stream: true`,
   * the text yielded as it arrives, and each call's pieces gathered by the index the
   * protocol gives them.
   *
   * A transport failure throws out of `pieces` and rejects `calls`, both naming the case.
   * Arguments that do not parse fail only `calls`: the text already arrived whole, and
   * the caller decides what a botched call means.
   */
  const askWithTools = (messages: Message[], about: About, tools: Tool[]): Step => {
    let settle: (calls: ToolCall[]) => void = () => {};
    let refuse: (reason: Error) => void = () => {};
    const calls = new Promise<ToolCall[]>((resolve, reject) => {
      settle = resolve;
      refuse = reject;
    });
    // A caller that stopped at a failure of `pieces` has already heard of it.
    calls.catch(() => {});

    async function* pieces(): AsyncIterable<string> {
      const gathered = new Map<number, { id: string; name: string; arguments: string }>();
      try {
        const stream = await client.chat.completions.create(
          {
            model: config.model,
            messages,
            stream: true,
            tools: tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as Record<string, unknown>,
              },
            })),
          },
          options(about),
        );
        for await (const piece of stream) {
          const delta = piece.choices[0]?.delta;
          if (typeof delta?.content === "string" && delta.content !== "") yield delta.content;
          for (const call of delta?.tool_calls ?? []) {
            const held = gathered.get(call.index) ?? { id: "", name: "", arguments: "" };
            gathered.set(call.index, {
              id: call.id ?? held.id,
              name: call.function?.name ?? held.name,
              arguments: held.arguments + (call.function?.arguments ?? ""),
            });
          }
        }
      } catch (cause) {
        const said = failure(about, cause);
        refuse(said);
        throw said;
      }
      try {
        settle(
          [...gathered.entries()]
            .sort(([one], [other]) => one - other)
            .map(([, call]) => ({
              id: call.id,
              name: call.name,
              arguments: JSON.parse(call.arguments === "" ? "{}" : call.arguments) as unknown,
              argumentsText: call.arguments === "" ? "{}" : call.arguments,
            })),
        );
      } catch (cause) {
        refuse(failure(about, cause));
      }
    }

    return { pieces: pieces(), calls };
  };

  return { ask, askStreaming, askFor, askWithTools };
};

/**
 * The second client of the same provider (D24, D27): a LangChain chat model built from
 * the same configuration as `createAi`, for a caller that speaks LangChain's messages and
 * tools.
 *
 * Each field is the one the spec's 3.2 table names. The class is `ChatOpenAICompletions`
 * (`ID281`), which always calls chat completions: `ChatOpenAI`'s `useResponsesApi: false`
 * cannot keep a model whose name the library prefers on the Responses API from going
 * there, and every OpenAI-compatible endpoint serves chat completions. The retries stay
 * the two the `openai` package makes today, in place of the six `@langchain/core`'s
 * caller would make; `streamUsage` is left
 * at its default, so a streamed body asks for the usage chunk as any caller of the class
 * would. Nothing else is set: every sampling field stays undefined and leaves the body.
 *
 * The metadata header is not set here: a call passes it in its own options, since only
 * the caller knows which step a call is.
 */
export const createChatModel = (config: AiConfig): ChatOpenAICompletions =>
  new ChatOpenAICompletions({
    model: config.model,
    apiKey: config.apiKey,
    configuration: {
      baseURL: config.baseUrl,
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    },
    maxRetries: 2,
  });
