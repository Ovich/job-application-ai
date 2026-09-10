import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";
import { readStream, streamUrl } from "./support/stream";

/**
 * Whether a stream with nothing to say survives the distribution (US4).
 *
 * This is the question slice 3 was risky for, and it can only be asked here: the origin
 * read timeout is a property of the distribution's origin, not of the function, so a
 * run against the dev server would prove only that a Node server holds its own socket
 * open, which nobody doubts. It belongs to the `deployed` project for that reason and
 * runs nowhere else.
 *
 * The assertion is "still open", and the beats are the reason it is. A browser never
 * hands a comment to a page, so the page-driven version of this spec could only watch
 * for the failure; a raw read sees the beats themselves. If they did not reach the
 * distribution, the origin connection is dropped on the timeout and the read ends early.
 */

/**
 * The kind whose run the API paces slower than any timeout between the reader and the
 * function, so that nothing but the heartbeat is on the wire while this spec watches.
 * Named in `apps/api/src/handlers/runs.ts`.
 */
const idleProbeKind = "stream-idle";

/** Comfortably past the thirty seconds a distribution waits on a silent origin. */
const idleMs = 45_000;

/** How often the envelope beats (`apps/api/src/lib/stream/envelope.ts`). */
const heartbeatIntervalMs = 15_000;

test("a stream idle past the origin read timeout stays open", async ({ request, baseURL }) => {
  test.setTimeout(90_000);

  const id = await startRun(request, idleProbeKind, 1);

  const reading = await readStream(
    streamUrl(baseURL, id),
    { forMs: idleMs },
    // Wider than a beat, so a beat that is a little late is not a failure; narrower
    // than the origin read timeout, so a beat that never comes is.
    { silenceMs: 2 * heartbeatIntervalMs },
  );

  expect(reading.ended).toBe(false);
  expect(reading.arrivals).toEqual([]);
  // Two beats in forty-five seconds at fifteen apart, the third allowed to be in flight.
  expect(reading.beats).toBeGreaterThanOrEqual(Math.floor(idleMs / heartbeatIntervalMs) - 1);
});
