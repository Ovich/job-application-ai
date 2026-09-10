import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";

/**
 * Whether a stream with nothing to say survives the distribution.
 *
 * This is the question slice 3 was risky for, and it can only be asked here: the origin
 * read timeout is a property of the distribution's origin, not of the function, so a
 * run against the dev server would prove only that a Node server holds its own socket
 * open, which nobody doubts. It belongs to the `deployed` project for that reason and
 * runs nowhere else.
 *
 * The assertion is "still open" rather than "a beat arrived" because the heartbeat is a
 * comment, and a browser never hands a comment to the page. Its whole job is to be
 * invisible to the page and visible to everything between the two: if the beat did not
 * reach the distribution, the origin connection is dropped on the timeout and the
 * browser sees the stream fail.
 */

/**
 * The kind whose run the API paces slower than any timeout between the browser and the
 * function, so that nothing but the heartbeat is on the wire while this spec watches.
 * Named in `apps/api/src/handlers/runs.ts`.
 */
const idleProbeKind = "stream-idle";

/** Comfortably past the thirty seconds a distribution waits on a silent origin. */
const idleMs = 45_000;

test("a stream idle past the origin read timeout stays open", async ({ page, request }) => {
  test.setTimeout(90_000);

  const id = await startRun(request, idleProbeKind, 1);

  await page.goto("/");

  const stillOpen = await page.evaluate(
    ({ path, waitMs }) =>
      new Promise<boolean>((resolve) => {
        const source = new EventSource(path);
        let failed = false;
        source.addEventListener("error", () => {
          failed = true;
        });
        setTimeout(() => {
          const open = !failed && source.readyState === EventSource.OPEN;
          source.close();
          resolve(open);
        }, waitMs);
      }),
    { path: `/api/runs/${id}/stream`, waitMs: idleMs },
  );

  expect(stillOpen).toBe(true);
});
