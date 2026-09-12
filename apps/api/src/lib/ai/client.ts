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

/** The three ways a pipeline step asks. Nothing else is exposed. */
export type Ai = {
  ask: (messages: Message[], about: About) => Promise<string>;
  askStreaming: (messages: Message[], about: About) => AsyncIterable<string>;
  askFor: <T>(messages: Message[], about: About, shape: ZodType<T>) => Promise<T>;
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
const named = async <T>(about: About, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (cause) {
    throw new Error(
      `The AI call about ${tagOf(about)} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
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

  return { ask, askStreaming, askFor };
};
