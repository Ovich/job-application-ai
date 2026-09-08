export * from "./schema";

import type { run, runUnit } from "./schema";

/** A `run` row as read. */
export type Run = typeof run.$inferSelect;
/** A `run` row as written. */
export type NewRun = typeof run.$inferInsert;
/** A `run_unit` row as read. */
export type RunUnit = typeof runUnit.$inferSelect;
/** A `run_unit` row as written. */
export type NewRunUnit = typeof runUnit.$inferInsert;
/** The three states a unit can be in, derived from the column, never listed twice. */
export type RunUnitStatus = RunUnit["status"];
