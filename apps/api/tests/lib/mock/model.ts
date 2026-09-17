import { type Answer, ModelMock } from "../../../src/lib/mock";

/**
 * How the library's own suite reaches the mock: one instance with no answers of its own,
 * no application and no port, asked through `fetch` (`ID295`). The header names are the
 * library's defaults and the pace is `instant`, so nothing waits unless a request asks.
 */
export const model = new ModelMock([], { pace: "instant" });

/** A request as a client of either protocol sends it, to a host that is never resolved. */
export const request = (path: string, init: RequestInit): Promise<Response> =>
  model.fetch(new Request(`http://mock.test/v1${path}`, init));

/** The given cases, by name, until `dispose`. `stands_for` is the author's note, unread. */
export const withCases = (
  cases: Record<string, Omit<Answer, "case"> & { stands_for?: string }>,
): { dispose: () => void } => {
  model.use(
    ...Object.entries(cases).map(([name, { stands_for: _note, ...answer }]) => ({
      case: name,
      ...answer,
    })),
  );
  return { dispose: () => model.reset() };
};
