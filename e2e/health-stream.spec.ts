import { expect, test } from "@playwright/test";
import { apiUrl } from "./support/api";
import { openStream, readStream } from "./support/stream";

/**
 * Whether the value streams, and whether a stream survives what stands between the
 * function and the reader (US4).
 *
 * The subject is the *arrival* of the frames, not their content: a response buffered
 * anywhere along the way — by the server, by a compression layer, by the distribution —
 * still ends with the same frames in the reader's hands, so a check that only read the
 * final body would pass against exactly the failure this exists to prevent.
 *
 * Both projects run the first test. Against the dev server it is the quick loop, where
 * the API sits behind one proxy; against the development address it is the question the
 * check exists for, because that is the only place a distribution stands between the
 * function and the reader. The second test is the deployed project's alone, and says so
 * itself.
 */

/** The route's own pace, from `apps/api/src/handlers/health.ts`. */
const beatIntervalMs = 1_000;

/** How long a distribution waits on an origin that has said nothing. */
const originReadTimeoutMs = 30_000;

/** Comfortably past that timeout, with room for a beat to be late at the end. */
const watchMs = 40_000;

test("the health stream answers as an event stream", async ({ baseURL }) => {
  const opening = await openStream(apiUrl(baseURL, "/api/health/stream"));

  expect(opening.status).toBe(200);
  expect(opening.contentType).toContain("text/event-stream");
});

test("beats arrive one at a time, not in one buffered lump", async ({ baseURL }) => {
  const { arrivals } = await readStream(apiUrl(baseURL, "/api/health/stream"), { frames: 3 });

  const first = arrivals.at(0);
  const last = arrivals.at(-1);
  expect(arrivals).toHaveLength(3);

  // The assertion the check exists for: the first beat was in the reader's hands while
  // the later ones had not been written yet. A buffered response lands as one lump and
  // this difference collapses to nothing.
  expect((last?.at ?? 0) - (first?.at ?? 0)).toBeGreaterThan(beatIntervalMs * 1.5);

  // Numbered from one, ascending, and carrying the leaf the catalogue holds.
  expect(arrivals.map(({ frame }) => frame.seq)).toEqual([1, 2, 3]);
  expect(arrivals.every(({ frame }) => frame.kind === "text")).toBe(true);
});

test("a stream held past the origin read timeout stays open", async ({ baseURL }, testInfo) => {
  test.skip(
    testInfo.project.name !== "deployed",
    "the origin read timeout is a property of the distribution's origin; a laptop has none",
  );
  test.setTimeout(watchMs + 30_000);

  const reading = await readStream(
    apiUrl(baseURL, "/api/health/stream"),
    { forMs: watchMs },
    // Wider than a beat, so a beat that is a little late is not a failure; narrower
    // than the origin read timeout, so a beat that never comes is.
    { silenceMs: originReadTimeoutMs / 2 },
  );

  // The server did not end it, and the thing in between did not cut it.
  expect(reading.ended).toBe(false);
  // A beat a second for as long as the read lasted, less the ones that may be in
  // flight at either end: the connection was alive the whole way through the timeout.
  expect(reading.arrivals.length).toBeGreaterThanOrEqual(Math.floor(watchMs / beatIntervalMs) - 5);
  const last = reading.arrivals.at(-1);
  expect(last?.at ?? 0).toBeGreaterThan(originReadTimeoutMs);
});
