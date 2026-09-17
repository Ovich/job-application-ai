import { ChatOpenAICompletions } from "@langchain/openai";
// The client from the module that defines it, never from `lib/ai`'s index. A test of a
// route that calls `lib/ai` stands that index in through `vi.mock`, whose factory
// reaches this file; importing the index here would put this module inside the graph of
// the module it is standing in for, and the two would wait on each other for ever.
import { type AiConfig, createAskFor, createChatModel } from "../../src/lib/ai/client";
import type { Answer } from "../../src/lib/mock";
// The binding's instance, and not the application: `routes/mock` reaches no `lib/ai`, so
// importing it here puts nothing of the module a test stands in inside this file's graph.
import { model } from "../../src/routes/mock";

/**
 * The suite's own AI support (ID129).
 *
 * It hides three things: pointing the client at the application's own fetch handler, so
 * the serialisers are exercised the way HTTP would exercise them and no port is opened;
 * a test's own answers, given to the application's mock for the length of the test, so a
 * test records a case without adding a file to the project's answers; and the recording of
 * what was actually sent, which is how the request's shape is asserted (criterion 3).
 *
 * It leaves nothing behind: `withCases`'s `dispose` puts the mock back on its own answers.
 */

/** One request as it left `lib/ai`, before anything on the other side read it. */
export type Sent = { headers: Record<string, string>; body: unknown };

const sent: Sent[] = [];

/** Every request `lib/ai` has sent through this support since the last forgetting. */
export const requestsSent = (): Sent[] => sent;

/** Called between cases, so one test never reads another's requests. */
export const forgetRequests = (): void => {
  sent.length = 0;
};

/**
 * `fetch`, recorded and then answered by the application itself. No socket is opened
 * and no port is listened on: the request goes straight into `app.fetch`, which is the
 * same entry point the Node server and the Lambda runtime call.
 *
 * The application is imported when a request is actually made, not at the top of this
 * file, and that is load-bearing. A test of a route that calls `lib/ai` itself stands
 * `lib/ai` in through `vi.mock`, whose factory reaches this module; a static import of
 * `src/app` here would put the application inside that factory's own import graph and
 * the two would wait on each other for ever.
 */
export const recordingFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const read = request.clone();
  sent.push({
    headers: Object.fromEntries(read.headers),
    body: await read.json().catch(() => undefined),
  });
  const { app } = await import("../../src/app");
  return app.fetch(request);
};

/**
 * `lib/ai`, configured the way a laptop configures it but answered in this process. The
 * host is never resolved, because `recordingFetch` never reaches the network.
 */
const throughTheApp: AiConfig = {
  baseUrl: "http://api.test/mock/v1",
  apiKey: "the-mock-ignores-this",
  model: "mock-model",
  fetch: recordingFetch,
};

/**
 * The chat model (ID274): `createChatModel` on the configuration above and its recording
 * fetch.
 */
export const chatModelThroughTheApp = () => createChatModel(throughTheApp);

/** The reading's call (D30): `createAskFor` on `chatModelThroughTheApp()`. */
export const askForThroughTheApp = () => createAskFor(chatModelThroughTheApp());

/**
 * A chat model whose request for the case ending in `at` fails mid-stream (D25, ID274):
 * the answer's first chunk, one piece of text, arrives, then the body errors. Every other
 * request goes where `model`'s own would, on the same configuration.
 */
export const failingMidStream = (
  model: ChatOpenAICompletions,
  at: string,
): ChatOpenAICompletions => {
  const otherwise = model.clientConfig.fetch ?? fetch;
  const failing = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.headers.get("x-jobapp-case")?.endsWith(at)) return otherwise(input, init);
    const piece = {
      id: "chatcmpl-failing",
      object: "chat.completion.chunk",
      created: 0,
      model: model.model,
      choices: [{ index: 0, delta: { role: "assistant", content: "No pre" }, finish_reason: null }],
    };
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (sent) {
          controller.error(new Error("the model went away mid-stream"));
          return;
        }
        sent = true;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(piece)}\n\n`));
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  return new ChatOpenAICompletions({
    model: model.model,
    apiKey: throughTheApp.apiKey,
    configuration: { ...model.clientConfig, fetch: failing },
    maxRetries: 2,
  });
};

/** What `withCases` hands back: the cases are in place until it is disposed of. */
export type CasesInPlace = { dispose: () => void };

/**
 * One case as a test writes it: an answer minus its name, which the key carries, and what
 * it stands for, which is the author's own note and nothing the mock reads.
 */
export type CaseWritten = Omit<Answer, "case"> & { stands_for?: string };

/**
 * Gives the application's mock the given cases for the length of one test (`ID295`): they
 * are tried before the project's own answers, and `dispose` resets the mock to those. The
 * key is the case name.
 *
 * A `Disposable` would be the natural shape, and is not available: this repository's
 * TypeScript library is `ES2023`, which has no `Symbol.dispose`. `dispose()` in a
 * `finally` or an `afterEach` is the same discipline written by hand.
 */
export const withCases = (cases: Record<string, CaseWritten>): CasesInPlace => {
  model.use(
    ...Object.entries(cases).map(([name, { stands_for: _note, ...answer }]) => ({
      case: name,
      ...answer,
    })),
  );
  return { dispose: () => model.reset() };
};

/** Every request the application's mock answered since the last reset, and what it picked. */
export const requestsAnswered = () => model.requests;
