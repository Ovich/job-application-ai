import { type Answer, answerTo, type Held, inFolder, inline, placeholder } from "./answers";
import { chunksOf, intervalMs, type Pace, paceConfigured, paceOf } from "./pace";
import { anthropicFrames, anthropicWhole } from "./protocols/anthropic-messages";
import type { Frame } from "./protocols/frames";
import { openAiFrames, openAiWhole } from "./protocols/openai-chat";
import { asked, type Protocol } from "./request";

/**
 * A model that answers what was written for it, on the wire a provider answers on
 * (`ID295`).
 *
 * One class: a folder of answers or the same answers inline, one handler per protocol,
 * each `(Request) → Response` and nothing a framework owns, so the file that binds a
 * handler to a path is the file that decides the path. The two handlers are the two
 * envelopes, and they are the only thing that differs between them: one answer answers on
 * both, wrapped by its own serialiser, streamed or whole by the protocol's own
 * `stream: true`.
 *
 * It holds no client and imports nothing that could open a connection, so a request it has
 * no answer for is a miss and never a call: a double that can reach the network can spend
 * money and can hide a missing answer behind a real one (spec `D20`).
 */

export type ModelMockOptions = {
  /** Default realistic; a string is the spec form, `tps=40;ttft=400`. */
  pace?: Partial<Pace> | "instant" | string;
  /** `as-asked` (the default) follows the request's own `stream`; the others override it. */
  stream?: "as-asked" | "always" | "never";
  /** The header a request names a case in. Default `x-mock-case`. */
  caseHeader?: string;
  /** The header a request asks for its own pace in. Default `x-mock-pace`. */
  paceHeader?: string;
  /** What a request with no answer gets: the placeholder text (the default), or a 404. */
  onMiss?: "placeholder" | "error";
};

/** One request answered, and what was picked: a test's evidence. */
export type Answered = {
  protocol: Protocol;
  headers: Record<string, string>;
  body: unknown;
  lastUserMessage: string | null;
  /** The answer's id, or null on a miss. */
  picked: string | null;
};

/**
 * Which wrapper a handler puts an answer in. The answer itself names no protocol (`D11`).
 * The answer comes last to `frames`, after the pieces of its content the pace cut.
 */
type Envelope = {
  protocol: Protocol;
  whole: (answer: Held, model: string) => object;
  frames: (
    model: string,
    chunks: string[],
    answer: Held,
    asked: { includeUsage: boolean },
  ) => Frame[];
};

const openAi: Envelope = { protocol: "openai-chat", whole: openAiWhole, frames: openAiFrames };
const anthropic: Envelope = {
  protocol: "anthropic-messages",
  whole: anthropicWhole,
  frames: anthropicFrames,
};

const wait = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise((done) => setTimeout(done, ms));

/** One frame as server-sent events spell it: the event's name when it has one, then its data. */
const written = (frame: Frame): string =>
  [
    ...(frame.event === undefined ? [] : [`event: ${frame.event}`]),
    ...frame.data.split("\n").map((line) => `data: ${line}`),
  ].join("\n");

/**
 * The frames as a paced event stream. The wrappers a protocol opens and closes with go out
 * as fast as they are written; only the pieces of the answer wait on the pace.
 */
const streamed = (frames: Frame[], pace: Pace): Response => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      await wait(pace.timeToFirstTokenMs);
      let pieces = 0;
      for (const frame of frames) {
        if (frame.paced === true) {
          if (pieces > 0) await wait(intervalMs(pace));
          pieces += 1;
        }
        if (cancelled) return;
        controller.enqueue(encoder.encode(`${written(frame)}\n\n`));
      }
      controller.close();
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return new Response(body, {
    headers: {
      "Transfer-Encoding": "chunked",
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

export class ModelMock {
  private readonly folder: string | null;
  private readonly inline: Held[];
  private used: Held[] = [];
  private readonly answered: Answered[] = [];
  private readonly pace: Pace;
  private readonly streams: "as-asked" | "always" | "never";
  private readonly caseHeader: string;
  private readonly paceHeader: string;
  private readonly onMiss: "placeholder" | "error";

  /** A folder of answer files, or the same answers inline. */
  constructor(answers: string | Answer[], options: ModelMockOptions = {}) {
    this.folder = typeof answers === "string" ? answers : null;
    this.inline = typeof answers === "string" ? [] : inline(answers);
    this.pace = paceConfigured(options.pace);
    this.streams = options.stream ?? "as-asked";
    this.caseHeader = options.caseHeader ?? "x-mock-case";
    this.paceHeader = options.paceHeader ?? "x-mock-pace";
    this.onMiss = options.onMiss ?? "placeholder";
  }

  /** OpenAI chat completions, for whatever path a route file gives it. */
  readonly chatCompletions = (request: Request): Promise<Response> => this.answer(request, openAi);

  /** Anthropic messages: the same answers in the other envelope. */
  readonly messages = (request: Request): Promise<Response> => this.answer(request, anthropic);

  /**
   * The zero-configuration way in, for a standalone server or a client's own option:
   * dispatches to the handlers above by the conventional path suffix, 404 otherwise.
   */
  readonly fetch = (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith("/chat/completions")) return this.chatCompletions(request);
    if (pathname.endsWith("/messages")) return this.messages(request);
    return Promise.resolve(
      Response.json(
        { error: { type: "not_found", message: `The mock answers no ${pathname}` } },
        { status: 404 },
      ),
    );
  };

  /** Answers added on top of the constructor's, tried first, until reset(). */
  use(...answers: Answer[]): void {
    this.used = [...inline(answers), ...this.used];
  }

  /** Every request answered, in order, and what was picked: a test's evidence. */
  get requests(): readonly Answered[] {
    return this.answered;
  }

  /** Back to the constructor's answers, and the request log emptied. */
  reset(): void {
    this.used = [];
    this.answered.length = 0;
  }

  private async answer(request: Request, envelope: Envelope): Promise<Response> {
    const read = await asked(request, this.caseHeader);
    // The folder is read on every request, so an edited file is the next answer.
    const constructed = this.folder === null ? this.inline : inFolder(this.folder);
    const held = answerTo([...this.used, ...constructed], read);
    this.answered.push({
      protocol: envelope.protocol,
      headers: read.headers,
      body: read.body,
      lastUserMessage: read.lastUserMessage,
      picked: held?.id ?? null,
    });

    if (held === undefined) {
      const missed = `no answer for the case ${read.caseName ?? `(none named in ${this.caseHeader})`}, nor one that \`answers\` the last user message`;
      if (this.onMiss === "error") {
        return Response.json(
          { error: { type: "not_found", message: `mock: ${missed}.` } },
          { status: 404 },
        );
      }
      // The answer does not say what was missed, so the log does, in one line (`ID198`).
      // The case is named and the message is not: a message is the person's own words.
      console.warn(`mock: ${missed}; answered "${placeholder.content}".`);
    }
    const answer = held ?? placeholder;

    const streaming = this.streams === "as-asked" ? read.stream : this.streams === "always";
    if (!streaming) return Response.json(envelope.whole(answer, read.model));

    const pace = paceOf(request.headers, this.paceHeader, this.pace);
    return streamed(
      envelope.frames(read.model, chunksOf(answer.content, pace), answer, {
        includeUsage: read.includeUsage,
      }),
      pace,
    );
  }
}
