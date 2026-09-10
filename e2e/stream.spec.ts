import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";

/**
 * Whether the value streams. The subject here is the *arrival* of the events, not
 * their content: a response buffered anywhere along the way — by the server, by a
 * compression layer, by the distribution — still ends with the same text on
 * the page, so a spec that only checked the final text would pass against exactly the
 * failure this slice exists to prevent.
 *
 * Both projects run it. Against the dev server it is the quick loop, where the page and
 * the API are two processes and one proxy; against the development address it is the
 * question the slice exists for, because that is the only place a distribution stands
 * between the function and the browser. The related question of what happens to a
 * stream that says nothing is `e2e/idle.spec.ts`, deployed only.
 */

/** How far apart the first and the last event must land before "progressive" means anything. */
const progressiveGapMs = 200;

/** How long the run under test is: enough units that the work cannot land in one tick. */
const units = 4;

/** One event as the browser received it, with the moment it arrived. */
type Arrival = {
  readonly at: number;
  /** The frame's own sequence: its position in the stream. */
  readonly seq: number;
  readonly kind: string;
  /** The unit's sequence, its position in the run, on a progress leaf only. */
  readonly unitSeq: number | null;
  readonly status: string | null;
};

test("the run's stream answers as an event stream", async ({ page, request }) => {
  const id = await startRun(request, "stream-headers", 1);
  await page.goto("/");

  // `fetch` resolves on the headers, so this reads them without draining the body,
  // and the abort lets the run go without a reader. Its own run, so the measurement
  // below is never handed a stream this probe has already moved along.
  const opening = await page.evaluate(async (path) => {
    const controller = new AbortController();
    const response = await fetch(path, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    const status = response.status;
    const contentType = response.headers.get("content-type");
    controller.abort();
    return { status, contentType };
  }, `/api/runs/${id}/stream`);

  expect(opening.status).toBe(200);
  expect(opening.contentType).toContain("text/event-stream");
});

test("events arrive progressively, not in one buffered lump", async ({ page, request }) => {
  const id = await startRun(request, "stream-demo", units);

  // A document at the same origin, so the stream is an ordinary same-origin request:
  // the dev server forwards `/api`, and one distribution will serve both in the cloud.
  await page.goto("/");

  const arrivals: Arrival[] = await page.evaluate(
    ({ path, lastUnit, silenceMs }) =>
      new Promise<Arrival[]>((resolve, reject) => {
        const seen: Arrival[] = [];
        const source = new EventSource(path);

        const guard = setTimeout(() => {
          source.close();
          reject(new Error(`the stream said nothing for ${silenceMs}ms`));
        }, silenceMs);

        const finish = () => {
          clearTimeout(guard);
          source.close();
          resolve(seen);
        };

        source.addEventListener("message", (event) => {
          const at = performance.now();
          const frame = JSON.parse(event.data) as {
            seq: number;
            version: number;
            leaf: { kind: string; seq?: number; status?: string; text?: string };
          };
          seen.push({
            at,
            seq: frame.seq,
            kind: frame.leaf.kind,
            unitSeq: frame.leaf.seq ?? null,
            status: frame.leaf.status ?? null,
          });
          // The run is over when its last unit has left `pending`, whichever way it
          // went; waiting for the server to close would measure the close, not the run.
          if (
            frame.leaf.kind === "progress" &&
            frame.leaf.seq === lastUnit &&
            frame.leaf.status !== "pending"
          ) {
            finish();
          }
        });

        // A server that closes the stream reaches an EventSource as an error, and it
        // would reconnect if left alone. Either way the run is over by then, and what
        // arrived before it is what this spec measures.
        source.addEventListener("error", () => {
          if (seen.length > 0) {
            finish();
            return;
          }
          clearTimeout(guard);
          source.close();
          reject(new Error("the stream failed before sending anything"));
        });
      }),
    { path: `/api/runs/${id}/stream`, lastUnit: units, silenceMs: 15_000 },
  );

  const first = arrivals.at(0);
  const last = arrivals.at(-1);
  expect(arrivals.length).toBeGreaterThanOrEqual(units);
  expect(first).toBeDefined();
  expect(last).toBeDefined();

  // The assertion the slice exists for: the first event was in the browser's hands
  // while the rest of the run had not happened yet. A buffered response lands as one
  // lump and this difference collapses to nothing.
  expect((last?.at ?? 0) - (first?.at ?? 0)).toBeGreaterThan(progressiveGapMs);

  // Each frame is numbered from one, ascending, so a browser that reconnects can name
  // the last sequence it saw and ask for what came after it.
  expect(arrivals.map(({ seq }) => seq)).toEqual(arrivals.map((_arrival, index) => index + 1));

  // And the content did arrive: every unit of the run reported its progress.
  expect(arrivals.filter(({ kind }) => kind === "progress").map(({ unitSeq }) => unitSeq)).toEqual(
    Array.from({ length: units }, (_unit, index) => index + 1),
  );
  expect(last?.status).toBe("done");
});
