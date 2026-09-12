import OpenAI from "openai";
import type { ZodType } from "zod";
import type { CaseName, Message } from "./types";

/**
 * The one AI client (ID107, ID108).
 *
 * The official `openai` package, pointed at a base URL configuration decides, and no
 * wrapper of our own around the transport: the wire shape *is* the abstraction. The
 * mock, OpenAI, Azure, a self-hosted vLLM and Anthropic's OpenAI-compatible endpoint
 * are then one integration, and the only difference between a mocked run and a real one
 * is the value of `AI_BASE_URL`.
 *
 * What this module hides from a pipeline step: the client's construction, the base URL,
 * the key, the model, the case header, and the difference between a streamed answer and
 * a whole one. What it must never hold is a branch on which of those is on the other
 * side. If something cannot be done without knowing, that is a finding for the spec and
 * not an `if` to write here.
 *
 * It reads no environment. Its configuration arrives as values, from `env.ts`, which is
 * the one reader — and from the suite, which hands it a fetch that dispatches into this
 * application's own handler so the double answers in-process with no port open.
 */

/** Everything the client needs, as values. */
export type AiConfig = {
  /** Ends at the `/v1`-equivalent: the client appends `/chat/completions` itself. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * How a request is put on the wire. The default is the platform's `fetch`, and the
   * two callers that pass their own are the suite and, at SL6, the deployed function
   * dispatching to its own mock without a network hop (ID130).
   */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

/** The three ways a pipeline step asks. Nothing else is exposed. */
export type Ai = {
  ask: (of: CaseName, messages: Message[]) => Promise<string>;
  askStreaming: (of: CaseName, messages: Message[]) => AsyncIterable<string>;
  askFor: <T>(of: CaseName, messages: Message[], shape: ZodType<T>) => Promise<T>;
};

/** The header a case travels in. A provider ignores what it does not know (ID111). */
const caseHeader = "X-Jobapp-Case";

/**
 * Every failure of a call comes back naming the case it was for. A `404` from the mock
 * means nobody recorded that case, and the one thing a person reading the failure needs
 * is which case to record; the underlying error is kept as the cause.
 */
const named = async <T>(of: CaseName, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (cause) {
    throw new Error(
      `The AI call for case ${of} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * caller wants pieces — the protocol's own `stream`. Nothing else. The case travels
   * as a header, set here and never by a caller, so no step can forget it and no body
   * carries a field a provider would reject.
   */
  const options = (of: CaseName) => ({ headers: { [caseHeader]: of } });

  const ask = (of: CaseName, messages: Message[]): Promise<string> =>
    named(of, async () => {
      const answer = await client.chat.completions.create(
        { model: config.model, messages },
        options(of),
      );
      const content = answer.choices[0]?.message.content;
      if (typeof content !== "string") throw new Error("the answer carried no content");
      return content;
    });

  async function* askStreaming(of: CaseName, messages: Message[]): AsyncIterable<string> {
    const pieces = await named(of, () =>
      client.chat.completions.create({ model: config.model, messages, stream: true }, options(of)),
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
  const askFor = async <T>(of: CaseName, messages: Message[], shape: ZodType<T>): Promise<T> => {
    const answer = await ask(of, messages);
    return named(of, async () => shape.parse(JSON.parse(answer)));
  };

  return { ask, askStreaming, askFor };
};
