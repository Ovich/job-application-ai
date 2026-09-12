import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../../src/app";
import { type CaseName, createAi } from "../../src/lib/ai";
import { type RecordedCase, useFixtureRoot } from "../../src/lib/ai/mock";

/**
 * The suite's own AI support (ID129).
 *
 * It hides three things: pointing the client at the application's own fetch handler, so
 * the serialisers are exercised the way HTTP would exercise them and no port is opened;
 * a temporary fixture root, so a test can record a case of its own without adding a file
 * to the product's fixture tree; and the recording of what was actually sent, which is
 * how the request's shape is asserted (criterion 3).
 *
 * It leaves nothing behind: `withCases` removes its directory and puts the fixture root
 * back where it was.
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
 */
const recordingFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const read = request.clone();
  sent.push({
    headers: Object.fromEntries(read.headers),
    body: await read.json().catch(() => undefined),
  });
  return app.fetch(request);
};

/**
 * `lib/ai`, configured the way a laptop configures it but answered in this process. The
 * host is never resolved, because `recordingFetch` never reaches the network.
 */
export const aiThroughTheApp = () =>
  createAi({
    baseUrl: "http://api.test/mock/v1",
    apiKey: "the-mock-ignores-this",
    model: "mock-model",
    fetch: recordingFetch,
  });

/** What `withCases` hands back: the cases are in place until it is disposed of. */
export type CasesInPlace = { dispose: () => void };

/**
 * Writes the given cases into a temporary fixture tree and points the mock's loader at
 * it, for the length of one test. The key is the case name; the value is the recorded
 * case as a fixture file holds it, minus the name, which the key already carries.
 *
 * A `Disposable` would be the natural shape, and is not available: this repository's
 * TypeScript library is `ES2023`, which has no `Symbol.dispose`. `dispose()` in a
 * `finally` or an `afterEach` is the same discipline written by hand.
 */
export const withCases = (cases: Record<CaseName, Omit<RecordedCase, "case">>): CasesInPlace => {
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
  const previous = useFixtureRoot(root);
  return {
    dispose: () => {
      useFixtureRoot(previous);
      rmSync(root, { recursive: true, force: true });
    },
  };
};
