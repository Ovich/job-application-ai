import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The client from the module that defines it, never from `lib/ai`'s index. A test of a
// route that calls `lib/ai` stands that index in through `vi.mock`, whose factory
// reaches this file; importing the index here would put this module inside the graph of
// the module it is standing in for, and the two would wait on each other for ever.
import { type AiConfig, createAi, createChatModel } from "../../src/lib/ai/client";
import { type RecordedCaseFile, withAnswersFrom } from "../../src/lib/mock";

/**
 * The suite's own AI support (ID129).
 *
 * It hides three things: pointing the client at the application's own fetch handler, so
 * the serialisers are exercised the way HTTP would exercise them and no port is opened;
 * a temporary tree of answer documents, so a test can record a case of its own without
 * adding a file to the product's own tree; and the recording of what was actually sent, which is
 * how the request's shape is asserted (criterion 3).
 *
 * It leaves nothing behind: `withCases` removes its directory and puts the double's own
 * tree back.
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

export const aiThroughTheApp = () => createAi(throughTheApp);

/**
 * The agent's chat model (ID274): `createChatModel` on the same configuration and the
 * same recording fetch as `aiThroughTheApp`.
 */
export const chatModelThroughTheApp = () => createChatModel(throughTheApp);

/** What `withCases` hands back: the cases are in place until it is disposed of. */
export type CasesInPlace = { dispose: () => void };

/**
 * Writes the given cases into a temporary tree and points the double's loader at it, for the length of one test. The key is the case name; the value is the recorded
 * case as an answer document holds it, minus the name, which the key already carries.
 *
 * A `Disposable` would be the natural shape, and is not available: this repository's
 * TypeScript library is `ES2023`, which has no `Symbol.dispose`. `dispose()` in a
 * `finally` or an `afterEach` is the same discipline written by hand.
 */
export const withCases = (cases: Record<string, Omit<RecordedCaseFile, "case">>): CasesInPlace => {
  const root = mkdtempSync(join(tmpdir(), "jobapp-cases-"));
  for (const [name, recorded] of Object.entries(cases)) {
    const directory = join(root, name.slice(0, name.indexOf(".")));
    mkdirSync(directory, { recursive: true });
    // The file's name mirrors the product's tree, `<feature>/<step>__<input>.json`: a
    // case name carries a colon, which is not a character a file name may hold.
    const file = `${name.slice(name.indexOf(".") + 1).replace(":", "__")}.json`;
    writeFileSync(
      join(directory, file),
      `${JSON.stringify({ case: name, ...recorded }, null, 2)}\n`,
      "utf8",
    );
  }
  const undo = withAnswersFrom(root);
  return {
    dispose: () => {
      undo();
      rmSync(root, { recursive: true, force: true });
    },
  };
};
