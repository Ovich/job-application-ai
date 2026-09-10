import { run, runUnit } from "@app/db";
import { zValidator } from "@hono/zod-validator";
import { asc, desc, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { z } from "zod";
import { db } from "../lib/db";
import { createEnvelope } from "../lib/stream";

const factory = createFactory();

/**
 * The body that creates a run. `kind` is derived from the table through drizzle-zod so
 * it cannot drift from the column (rule 6); `units` is composed onto it because it is
 * a count of rows to create, not a column of any row. The upper bound keeps one
 * request from asking for a write nobody meant.
 */
const newRunBody = createInsertSchema(run)
  .pick({ kind: true })
  .extend({ units: z.number().int().positive().max(1000) });

/** The most recent run, with its units in sequence order. */
export const readLatestRun = factory.createHandlers(async (c) => {
  const [latest] = await db.select().from(run).orderBy(desc(run.createdAt)).limit(1);
  if (!latest) {
    return c.json({ error: "no run has been created yet" }, 404);
  }

  const units = await db
    .select()
    .from(runUnit)
    .where(eq(runUnit.runId, latest.id))
    .orderBy(asc(runUnit.seq));

  return c.json({
    id: latest.id,
    kind: latest.kind,
    createdAt: latest.createdAt,
    finishedAt: latest.finishedAt,
    // The run's id is on the envelope already, so a unit carries only what identifies
    // it within the run and what it is doing.
    units: units.map(({ seq, status, result, doneAt }) => ({ seq, status, result, doneAt })),
  });
});

/**
 * A new run and the units it is made of, numbered from one. Run and units are written
 * in one transaction, a run with some of its units being a state nothing can use.
 * Status is left to the column's default rather than restated here.
 */
export const createRun = factory.createHandlers(zValidator("json", newRunBody), async (c) => {
  const { kind, units } = c.req.valid("json");

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(run).values({ kind }).returning();
    if (!inserted) {
      throw new Error("inserting a run returned no row");
    }

    await tx
      .insert(runUnit)
      .values(
        Array.from({ length: units }, (_, index) => ({ runId: inserted.id, seq: index + 1 })),
      );

    return inserted;
  });

  return c.json(
    {
      id: created.id,
      kind: created.kind,
      createdAt: created.createdAt,
      finishedAt: created.finishedAt,
    },
    201,
  );
});

/**
 * The run whose stream is asked for. A path parameter reaches a handler as a string,
 * and an id that is not a uuid would otherwise become a database error rather than a
 * bad request, so it is validated at the door like a body is.
 */
const streamParams = z.object({ id: z.uuid() });

/**
 * How long the stand-in takes over one unit. **This is a placeholder, not the work.**
 * The AI engine is deferred to a later slot, so a run has nothing real to do yet, and
 * a stream whose events all land in the same tick cannot show the one property this
 * slice exists to prove: that the browser holds the first event while the rest of the
 * run has not happened. The pause is what stands in for that work, and it comes out
 * the moment there is work to await instead.
 */
const placeholderUnitMs = 150;

/**
 * The kind of run that says nothing. A stream carrying events proves that events get
 * through; it proves nothing about a stream that has fallen silent, which is the case a
 * distribution kills on its origin read timeout and the case the heartbeat exists for.
 * So one kind of run is paced slower than any timeout between the browser and the
 * function, and `e2e/idle.spec.ts` watches it say nothing while the connection stays up.
 *
 * A kind rather than a query parameter or a header: what a run is doing is a property
 * of the run, written down with it, and a caller that names this kind is asking for a
 * probe rather than bending the behaviour of an ordinary run.
 */
export const idleProbeKind = "stream-idle";

/**
 * How long the probe takes over one unit. Two minutes leaves the distribution's thirty
 * second origin read timeout far behind, with room for a spec that watches for the
 * better part of a minute, and stays well inside the function's own five.
 */
export const idleProbeUnitMs = 120_000;

/** How long a run of this kind spends on one unit before it says anything. */
const unitPaceMs = (kind: string): number =>
  kind === idleProbeKind ? idleProbeUnitMs : placeholderUnitMs;

/**
 * How often a pause looks up to see whether anyone is still listening. A pause is the
 * only place a run spends time, so waiting one out in a single sleep would leave an
 * abandoned probe running for two minutes after the browser had gone, and would leave a
 * test that let go of a stream holding a timer it cannot clear.
 */
const abortCheckMs = 250;

/** What a pause needs of the response it is pausing inside: the wait, and the two ways
 * a stream can already be over. Narrower than the streaming API on purpose, so this
 * helper says exactly what it touches. */
type Pausable = {
  sleep: (ms: number) => Promise<unknown>;
  readonly aborted: boolean;
  readonly closed: boolean;
};

/**
 * Waits, and says whether it is still worth going on. `false` means the browser left
 * while the pause was running.
 */
const pause = async (response: Pausable, ms: number): Promise<boolean> => {
  for (let waited = 0; waited < ms; waited += abortCheckMs) {
    if (response.aborted || response.closed) {
      return false;
    }
    await response.sleep(Math.min(abortCheckMs, ms - waited));
  }
  return !(response.aborted || response.closed);
};

/**
 * The run's units as they progress, streamed as server-sent events. The envelope owns
 * the wire format, the numbering and the keep-alive: this handler chooses what is said
 * and when, and writes nothing to the response itself (ID11, ID31).
 *
 * It reads and reports, it does not persist. Writing each unit's result back as it
 * finishes, and resuming from the sequence a reconnecting browser names, are the runs
 * module of slice 4. `Last-Event-ID` is therefore deliberately not read here: framing
 * from a resumed sequence while the run itself replays from its first unit would
 * number old content as though it were new, which is worse than starting at one.
 */
export const streamRun = factory.createHandlers(zValidator("param", streamParams), async (c) => {
  const { id } = c.req.valid("param");

  const [found] = await db.select().from(run).where(eq(run.id, id)).limit(1);
  if (!found) {
    return c.json({ error: "no such run" }, 404);
  }

  const units = await db
    .select()
    .from(runUnit)
    .where(eq(runUnit.runId, found.id))
    .orderBy(asc(runUnit.seq));

  // The raw stream helper rather than the server-sent-event one: the envelope already
  // writes `id:` and `data:` lines, and the SSE helper would prefix them again. So the
  // headers that helper sets are set here instead. `x-accel-buffering` asks a reverse
  // proxy not to collect the response into one lump, which is exactly the failure the
  // browser spec measures.
  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("x-accel-buffering", "no");

  return stream(c, async (response) => {
    // The envelope's sink returns nothing, so the write is awaited here rather than
    // handed back: back-pressure is honoured, and the frame is on the socket before the
    // next one is framed.
    const envelope = createEnvelope(async (chunk) => {
      await response.write(chunk);
    });
    // A browser that navigates away mid-run leaves a heartbeat armed, which would go
    // on writing into a dead socket every fifteen seconds for as long as the process
    // lives. Closing on abort is what keeps a disconnect from costing anything.
    response.onAbort(() => {
      envelope.close();
    });

    try {
      for (const unit of units) {
        if (!(await pause(response, unitPaceMs(found.kind)))) {
          break;
        }
        await envelope.send({ kind: "text", text: `unit ${unit.seq} of ${units.length}\n` });
        await envelope.send({ kind: "progress", seq: unit.seq, status: "done" });
      }
    } finally {
      envelope.close();
    }
  });
});
