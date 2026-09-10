import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";
import { type Frame, type Reading, readStream, streamUrl } from "./support/stream";

/**
 * Whether the run survives a cut connection (US5). The subject is what a client loses
 * when it stops listening: nothing but the unit that was in flight. A run whose results
 * existed only in the stream would have to start again from its first unit, and a
 * client reopened on it would be shown a run that had never happened.
 *
 * The cut is made by the reader, by closing the connection mid-run, because that is
 * what a closed laptop, a lost network and a reload all look like to the server: the
 * response stops being read. What comes back afterwards is the whole assertion.
 */

/** How long the run under test is. Four units, paced at 150 ms, so the cut after the
 * second lands while the run genuinely has work left. */
const units = 4;

/** How many frames one finished unit spends: what it said, and that it is done. */
const framesPerUnit = 2;

/**
 * How long a whole run read back out of storage may take to reach a client that has
 * seen nothing. Half of what the four units take to do, so a stream that answered by
 * doing the run again cannot come in under it.
 */
const replayMs = 300;

/** What was said, without when: the comparison a replay has to satisfy word for word. */
const said = (reading: Reading): Frame[] => reading.arrivals.map(({ frame }) => frame);

test("a cut connection loses only the unit in flight, and the run carries on", async ({
  request,
  baseURL,
}) => {
  const id = await startRun(request, "resume-demo", units);

  // Two units, then the connection goes. The run has two units left to do.
  const beforeTheCut = said(
    await readStream(streamUrl(baseURL, id), { frames: 2 * framesPerUnit }),
  );
  expect(beforeTheCut.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  expect(beforeTheCut.filter(({ kind }) => kind === "progress")).toMatchObject([
    { unitSeq: 1, status: "done" },
    { unitSeq: 2, status: "done" },
  ]);

  // The client names the last sequence it saw, and receives what came after it: the
  // run continues at the third unit rather than starting again at the first.
  const afterTheCut = said(
    await readStream(streamUrl(baseURL, id, 2 * framesPerUnit), { frames: 2 * framesPerUnit }),
  );
  expect(afterTheCut.at(0)?.seq).toBe(5);
  expect(afterTheCut.filter(({ kind }) => kind === "progress")).toMatchObject([
    { unitSeq: 3, status: "done" },
    { unitSeq: 4, status: "done" },
  ]);

  // And a client reopened on the run, having seen nothing, is told the whole of it: the
  // first two units are still done, word for word what they said the first time.
  const reopened = said(
    await readStream(streamUrl(baseURL, id, 0), { frames: units * framesPerUnit }),
  );
  expect(reopened.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(reopened.slice(0, 4)).toEqual(beforeTheCut);
});

/**
 * Two clients on one run, opened at the same time. The pair (run, sequence) is the
 * primary key, so a unit is one row whoever writes it: neither client can make a unit
 * happen twice, and both are told the same thing.
 */
test("two clients on one run cannot make a unit happen twice", async ({ request, baseURL }) => {
  const id = await startRun(request, "resume-tabs", units);
  const whole = { frames: units * framesPerUnit };

  const [oneSaw, otherSaw] = await Promise.all([
    readStream(streamUrl(baseURL, id), whole),
    readStream(streamUrl(baseURL, id), whole),
  ]);

  expect(said(oneSaw)).toHaveLength(units * framesPerUnit);
  expect(said(oneSaw)).toEqual(said(otherSaw));

  // What settles it is what the run left behind. A third connection is told the whole
  // run out of storage, in less time than doing one unit takes: there is one result per
  // unit, written once, and neither client wrote a second one over it.
  const startedAt = performance.now();
  const replayed = await readStream(streamUrl(baseURL, id, 0), whole);
  expect(performance.now() - startedAt).toBeLessThan(replayMs);
  expect(said(replayed)).toEqual(said(oneSaw));
});
