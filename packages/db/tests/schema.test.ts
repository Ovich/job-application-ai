import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/schema";

/**
 * The schema is tested as the database understands it, not as TypeScript describes it.
 * A type says what this code may write; only PostgreSQL says what any writer may write,
 * and the reason the status is a Postgres enum rather than a text column is precisely
 * that the refusal happens there.
 *
 * Everything here runs against the project's own migration files applied to an
 * in-process PostgreSQL, so a migration that drifted from `src/schema.ts` fails here.
 */
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const db = drizzle(new PGlite(), { schema });
await migrate(db, { migrationsFolder });

beforeEach(async () => {
  await db.execute(sql`truncate table ${schema.run} restart identity cascade`);
});

const insertRun = async (): Promise<string> => {
  const [inserted] = await db.insert(schema.run).values({ kind: "demo" }).returning();
  if (!inserted) {
    throw new Error("inserting a run returned no row");
  }
  return inserted.id;
};

describe("run_unit_status", () => {
  it("accepts the three states a unit can be in", async () => {
    const runId = await insertRun();

    await db.insert(schema.runUnit).values([
      { runId, seq: 1, status: "pending" },
      { runId, seq: 2, status: "done" },
      { runId, seq: 3, status: "failed" },
    ]);

    expect(await db.select().from(schema.runUnit)).toHaveLength(3);
  });

  /**
   * The value is written as raw SQL because that is the only way to ask the question:
   * the Drizzle types refuse `skipped` at compile time, which proves nothing about a
   * migration, a psql session or a future writer.
   */
  it("refuses a status outside the enum", async () => {
    const runId = await insertRun();

    await expect(
      db.execute(sql`insert into run_unit (run_id, seq, status)
        values (${runId}, 1, 'skipped')`),
    ).rejects.toThrow(/skipped/);

    expect(await db.select().from(schema.runUnit)).toHaveLength(0);
  });
});
