import type { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAICompletions } from "@langchain/openai";
import type { ZodType } from "zod";

/**
 * The one AI client (ID107, ID108, ID145).
 *
 * One LangChain chat model on the chat-completions path (D30), pointed at a base URL
 * configuration decides, and no wrapper of our own around the transport: the wire shape
 * *is* the abstraction. OpenAI,
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

/**
 * The one client (D24, D27, D30): a LangChain chat model built from the configuration,
 * for every caller, the agent and the reading alike.
 *
 * Each field is the one the spec's 3.2 table names. The class is `ChatOpenAICompletions`
 * (`ID281`), which always calls chat completions: `ChatOpenAI`'s `useResponsesApi: false`
 * cannot keep a model whose name the library prefers on the Responses API from going
 * there, and every OpenAI-compatible endpoint serves chat completions. The retries stay
 * the two the `openai` package made for the loop, in place of the six `@langchain/core`'s
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

/**
 * The reading's call (D30): plain inference, one unstreamed `invoke`, no agent.
 *
 * The request keeps the fields the reading always sent: no `response_format`, no
 * structured output, so the answer to a request is what it was. The metadata header is set
 * here and never by a caller, at both places the class reads it (`ID282`): `headers` for
 * a streamed call and `options.headers` for an unstreamed one. Every later step wants a
 * shape, not prose: the answer is parsed and validated before it reaches a caller, so
 * there is no half-valid object to return (spec, *Failure modes*), and every failure is
 * named by the call's tag.
 */
export const createAskFor =
  (model: ChatOpenAICompletions) =>
  <T>(messages: BaseMessage[], about: About, shape: ZodType<T>): Promise<T> =>
    named(about, async () => {
      const headers = { [aboutHeader]: tagOf(about) };
      // The call options' type names neither field; the class reads both.
      const callOptions = { headers, options: { headers } } as Parameters<typeof model.invoke>[1];
      const answer = await model.invoke(messages, callOptions);
      if (typeof answer.content !== "string") throw new Error("the answer carried no content");
      return shape.parse(JSON.parse(answer.content));
    });
