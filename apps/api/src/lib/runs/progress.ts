import { type RunUnit, runUnit } from "@app/db";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";

/**
 * The runs module's progress: what a unit leaves behind when it finishes, written once
 * whoever writes it, and the arithmetic that says where a stream picks up for a client
 * that has already seen part of it.
 *
 * It exists as its own unit rather than inside the streaming handler because it is a
 * different concern from choosing what to say: the handler decides when a unit is done,
 * this decides what that means for the row and for the sequence. Inlining it would bury
 * the one property the run's survival rests on — that a unit is the same row twice — in
 * the middle of a loop that reads as though it were only writing to a socket.
 */

/**
 * How many frames one unit spends on the wire: what it said, then that it is done. The
 * envelope numbers frames and knows nothing about units, so the mapping between the two
 * lives here, once, and both the handler and the resume arithmetic read it from here.
 */
export const framesPerUnit = 2;

/** The sequence of the last frame a unit spends: its progress. */
const lastFrameOf = (unitSeq: number): number => unitSeq * framesPerUnit;

/**
 * Whether a client that saw everything up to `after` has seen the whole of this unit.
 * `after` is the last sequence it received, so the contract is exclusive — the next
 * frame it gets is `after + 1` — which is the contract the envelope's `startAfter`
 * already chose.
 */
export const hasSeenUnit = (unitSeq: number, after: number): boolean =>
  lastFrameOf(unitSeq) <= after;

/**
 * Whether that client has seen what this unit said, its text, whether or not it saw the
 * progress that followed. This is the half-seen unit a cut lands in the middle of:
 * repeating its text would print the same line on the page twice.
 */
export const hasSeenWhatUnitSaid = (unitSeq: number, after: number): boolean =>
  lastFrameOf(unitSeq) - 1 <= after;

/** A run's units in sequence order, which is the order they are done in. */
export const unitsOf = async (runId: string): Promise<RunUnit[]> =>
  await db.select().from(runUnit).where(eq(runUnit.runId, runId)).orderBy(asc(runUnit.seq));

/**
 * Records what a unit left behind, and answers with the row that stands afterwards.
 *
 * The write is idempotent on the run and its sequence, which is what lets two tabs
 * follow one run and a cut connection be reopened: the pair is the primary key, so
 * there is one row to write, and the `pending` in the condition is what makes the
 * second writer a reader. It finds the first one's result and reports that, so both
 * pages say the same thing and no result is ever written over another.
 *
 * The row is returned rather than a boolean because the caller needs what the unit
 * said, and after a lost race that is not what the caller was about to write.
 */
export const finishUnit = async (runId: string, seq: number, result: string): Promise<RunUnit> => {
  const [written] = await db
    .update(runUnit)
    .set({ status: "done", result, doneAt: new Date() })
    .where(and(eq(runUnit.runId, runId), eq(runUnit.seq, seq), eq(runUnit.status, "pending")))
    .returning();
  if (written) {
    return written;
  }

  const [standing] = await db
    .select()
    .from(runUnit)
    .where(and(eq(runUnit.runId, runId), eq(runUnit.seq, seq)))
    .limit(1);
  if (!standing) {
    throw new Error("finishing a unit of a run that has no such unit");
  }
  return standing;
};
