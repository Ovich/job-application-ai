import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";

/**
 * Whether the run survives a cut connection (US5). The subject is what the browser
 * loses when it stops listening: nothing but the unit that was in flight. A run whose
 * results existed only in the stream would have to start again from its first unit,
 * and a page reopened on it would show a run that had never happened.
 *
 * The cut is made from the page, by closing the source mid-run, because that is what a
 * closed laptop, a lost network and a reload all look like to the server: the response
 * stops being read. What comes back afterwards is the whole assertion.
 */

/** How long the run under test is. Four units, paced at 150 ms, so the cut after the
 * second lands while the run genuinely has work left. */
const units = 4;

/** How many frames one finished unit spends: what it said, and that it is done. */
const framesPerUnit = 2;

/** How long a connection may say nothing before the spec gives up on it. */
const silenceMs = 15_000;

/**
 * How long a whole run read back out of storage may take to reach a client that has
 * seen nothing. Half of what the four units take to do, so a stream that answered by
 * doing the run again cannot come in under it.
 */
const replayMs = 300;

/** One frame as the browser received it. */
type Frame = {
  readonly seq: number;
  readonly kind: string;
  /** The unit's position in the run, on a progress leaf only. */
  readonly unitSeq: number | null;
  readonly status: string | null;
  readonly text: string | null;
};

/**
 * Listens to a run's stream from inside the page, from after the sequence it names,
 * and closes the connection once it has `frames` of them or the run has ended. Runs in
 * the browser, so the connection is a real `EventSource` on the same origin, which is
 * what the application uses.
 */
const listen = async (
  page: import("@playwright/test").Page,
  options: { readonly id: string; readonly after?: number; readonly frames?: number },
): Promise<Frame[]> =>
  await page.evaluate(
    ({ path, want, quiet }) =>
      new Promise<Frame[]>((resolve, reject) => {
        const seen: Frame[] = [];
        const source = new EventSource(path);

        const guard = setTimeout(() => {
          source.close();
          reject(new Error(`the stream said nothing for ${quiet}ms`));
        }, quiet);

        const finish = () => {
          clearTimeout(guard);
          source.close();
          resolve(seen);
        };

        source.addEventListener("message", (event) => {
          const frame = JSON.parse(event.data) as {
            seq: number;
            leaf: { kind: string; seq?: number; status?: string; text?: string };
          };
          seen.push({
            seq: frame.seq,
            kind: frame.leaf.kind,
            unitSeq: frame.leaf.seq ?? null,
            status: frame.leaf.status ?? null,
            text: frame.leaf.text ?? null,
          });
          if (want !== null && seen.length >= want) {
            finish();
          }
        });

        // A server that has said everything closes the stream, which reaches an
        // EventSource as an error. What arrived before it is what the spec reads.
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
    {
      path:
        options.after === undefined
          ? `/api/runs/${options.id}/stream`
          : `/api/runs/${options.id}/stream?after=${options.after}`,
      want: options.frames ?? null,
      quiet: silenceMs,
    },
  );

test("a cut connection loses only the unit in flight, and the run carries on", async ({
  page,
  request,
}) => {
  const id = await startRun(request, "resume-demo", units);
  await page.goto("/");

  // Two units, then the connection goes. The run has two units left to do.
  const beforeTheCut = await listen(page, { id, frames: 2 * framesPerUnit });
  expect(beforeTheCut.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  expect(beforeTheCut.filter(({ kind }) => kind === "progress")).toMatchObject([
    { unitSeq: 1, status: "done" },
    { unitSeq: 2, status: "done" },
  ]);

  // The client names the last sequence it saw, and receives what came after it: the
  // run continues at the third unit rather than starting again at the first.
  const afterTheCut = await listen(page, { id, after: 2 * framesPerUnit });
  expect(afterTheCut.at(0)?.seq).toBe(5);
  expect(afterTheCut.filter(({ kind }) => kind === "progress")).toMatchObject([
    { unitSeq: 3, status: "done" },
    { unitSeq: 4, status: "done" },
  ]);

  // And a page reopened on the run, having seen nothing, is told the whole of it: the
  // first two units are still done, word for word what they said the first time.
  const reopened = await listen(page, { id, after: 0 });
  expect(reopened.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(reopened.slice(0, 4)).toEqual(beforeTheCut);
});

/**
 * Two tabs on one run, opened at the same time. The pair (run, sequence) is the
 * primary key, so a unit is one row whoever writes it: neither tab can make a unit
 * happen twice, and both are told the same thing.
 */
test("two tabs on one run cannot make a unit happen twice", async ({ browser, request }) => {
  const id = await startRun(request, "resume-tabs", units);

  const context = await browser.newContext();
  const [oneTab, otherTab] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([oneTab.goto("/"), otherTab.goto("/")]);

  const [oneSaw, otherSaw] = await Promise.all([listen(oneTab, { id }), listen(otherTab, { id })]);

  expect(oneSaw).toHaveLength(units * framesPerUnit);
  expect(oneSaw).toEqual(otherSaw);

  // What settles it is what the run left behind. A third connection is told the whole
  // run out of storage, in less time than doing one unit takes: there is one result per
  // unit, written once, and neither tab wrote a second one over it.
  const startedAt = Date.now();
  const replayed = await listen(oneTab, { id, after: 0 });
  expect(Date.now() - startedAt).toBeLessThan(replayMs);
  expect(replayed).toEqual(oneSaw);

  await context.close();
});
