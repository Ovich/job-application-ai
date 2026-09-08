import { run, runUnit } from "@app/db";
import { zValidator } from "@hono/zod-validator";
import { asc, desc, eq } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { createFactory } from "hono/factory";
import { z } from "zod";
import { db } from "../lib/db";

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
