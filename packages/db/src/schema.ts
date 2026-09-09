import { integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The status of one unit of work inside a run. A unit starts `pending`, and ends
 * either `done` or `failed`. A Postgres enum rather than a text column with a check,
 * so an impossible value cannot be written and the type flows to the API for free.
 */
export const runUnitStatus = pgEnum("run_unit_status", ["pending", "done", "failed"]);

/** One run: a piece of work made of ordered units. */
export const run = pgTable("run", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
});

/**
 * One unit of a run, identified by its run and its position in it. The pair is the
 * primary key, which is what makes writing a unit idempotent: the same run and the
 * same sequence is the same row, whoever writes it.
 */
export const runUnit = pgTable(
  "run_unit",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    status: runUnitStatus("status").notNull().default("pending"),
    result: text("result"),
    doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);
