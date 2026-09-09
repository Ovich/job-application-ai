import { fileURLToPath } from "node:url";
import * as schema from "@app/db/schema";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * A real PostgreSQL for the tests, running in this process.
 *
 * PGlite is PostgreSQL itself compiled to WebAssembly, so the tests exercise the same
 * planner, the same types and the same constraints the deployed cluster has: an
 * `ORDER BY` really orders, a `WHERE` really filters, an enum really refuses a value
 * outside it, and a transaction really rolls back. Nothing is started, nothing is
 * remote, there is no container and no credential (ID49, amending ID13, whose reasons
 * were speed and nothing running rather than a fake for its own sake).
 *
 * The schema comes from the project's own migration files, never from a helper that
 * recreates the tables: a helper would be a second description of the shape, free to
 * drift from the one the deploy applies. A migration that no longer builds the schema
 * the code queries fails here, on a laptop, in under a second.
 */
/*
 * Built from `import.meta.url`, never written as a relative path: `migrationsFolder`
 * is resolved against the process working directory, which is the repository root when
 * the root suite runs and this package when its own does. A relative path is right in
 * one of those and "Can't find meta/_journal.json" in the other.
 */
const migrationsFolder = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));

/**
 * The database every test in this package queries through, booted and migrated once
 * per test file. The boot costs about a second; a query on it costs single-digit
 * milliseconds.
 */
export const testDb = drizzle(new PGlite(), { schema });

await migrate(testDb, { migrationsFolder });

/**
 * Empties every table between tests. `run_unit` follows its run through
 * `ON DELETE CASCADE`, so truncating the parent is enough, and `RESTART IDENTITY`
 * keeps one test's rows from numbering the next one's.
 */
export const resetDatabase = async (): Promise<void> => {
  await testDb.execute(sql`truncate table ${schema.run} restart identity cascade`);
};
