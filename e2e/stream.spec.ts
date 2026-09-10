import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";
import { openStream, readStream, streamUrl } from "./support/stream";

/**
 * Whether the value streams (US4). The subject here is the *arrival* of the events, not
 * their content: a response buffered anywhere along the way, by the server, by a
 * compression layer, by the distribution, still ends with the same frames in the
 * reader's hands, so a spec that only checked the final content would pass against
 * exactly the failure this check exists to prevent.
 *
 * Both projects run it. Against the dev server it is the quick loop, where the API sits
 * behind one proxy; against the development address it is the question the check
 * exists for, because that is the only place a distribution stands between the function
 * and the reader. The related question of what happens to a stream that says nothing is
 * `e2e/idle.spec.ts`, deployed only.
 */

/** How far apart the first and the last event must land before "progressive" means anything. */
const progressiveGapMs = 200;

/** How long the run under test is: enough units that the work cannot land in one tick. */
const units = 4;

test("the run's stream answers as an event stream", async ({ request, baseURL }) => {
  // Its own run, so the measurement below is never handed a stream this probe has
  // already moved along.
  const id = await startRun(request, "stream-headers", 1);

  const opening = await openStream(streamUrl(baseURL, id));

  expect(opening.status).toBe(200);
  expect(opening.contentType).toContain("text/event-stream");
});

test("events arrive progressively, not in one buffered lump", async ({ request, baseURL }) => {
  const id = await startRun(request, "stream-demo", units);

  // The run is over when its last unit has left `pending`, whichever way it went;
  // waiting for the server to close would measure the close, not the run.
  const { arrivals } = await readStream(streamUrl(baseURL, id), {
    until: (frame) =>
      frame.kind === "progress" && frame.unitSeq === units && frame.status !== "pending",
  });

  const first = arrivals.at(0);
  const last = arrivals.at(-1);
  expect(arrivals.length).toBeGreaterThanOrEqual(units);
  expect(first).toBeDefined();
  expect(last).toBeDefined();

  // The assertion the check exists for: the first event was in the reader's hands
  // while the rest of the run had not happened yet. A buffered response lands as one
  // lump and this difference collapses to nothing.
  expect((last?.at ?? 0) - (first?.at ?? 0)).toBeGreaterThan(progressiveGapMs);

  // Each frame is numbered from one, ascending, so a client that reconnects can name
  // the last sequence it saw and ask for what came after it.
  const frames = arrivals.map(({ frame }) => frame);
  expect(frames.map(({ seq }) => seq)).toEqual(frames.map((_frame, index) => index + 1));

  // And the content did arrive: every unit of the run reported its progress.
  expect(frames.filter(({ kind }) => kind === "progress").map(({ unitSeq }) => unitSeq)).toEqual(
    Array.from({ length: units }, (_unit, index) => index + 1),
  );
  expect(last?.frame.status).toBe("done");
});
