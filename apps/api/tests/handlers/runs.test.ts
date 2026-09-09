import { run, runUnit } from "@app/db";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, testDb } from "../support/database";

/**
 * The handlers query the real thing. The database module is replaced by the in-process
 * PostgreSQL of `tests/support/database`, which is the only substitution: everything
 * below the Hono app — the SQL Drizzle builds, the ordering, the filtering, the enum,
 * the transaction — is the deployed behaviour, not a description of it.
 */
vi.mock("../../src/lib/db", async () => ({ db: (await import("../support/database")).testDb }));

const { app } = await import("../../src/app");

const olderRunAt = new Date("2026-09-01T10:00:00.000Z");
const latestRunAt = new Date("2026-09-08T10:00:00.000Z");

/**
 * Two runs and the units of each. The rows are inserted in an order no query should
 * depend on — the older run last, the units of the latest run 3, 1, 2 — so a handler
 * that leaves ordering to the table's physical order fails here rather than passing by
 * luck.
 */
const seedTwoRuns = async (): Promise<{ latestId: string; olderId: string }> => {
  const [latest] = await testDb
    .insert(run)
    .values({ kind: "demo", createdAt: latestRunAt })
    .returning();
  const [older] = await testDb
    .insert(run)
    .values({ kind: "demo", createdAt: olderRunAt })
    .returning();
  if (!latest || !older) {
    throw new Error("seeding a run returned no row");
  }

  await testDb.insert(runUnit).values([
    { runId: latest.id, seq: 3, status: "pending" },
    { runId: latest.id, seq: 1, status: "done" },
    { runId: latest.id, seq: 2, status: "failed" },
    { runId: older.id, seq: 1, status: "done" },
    { runId: older.id, seq: 2, status: "done" },
  ]);

  return { latestId: latest.id, olderId: older.id };
};

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/runs/latest", () => {
  it("returns the most recent run, not an older one", async () => {
    const { latestId } = await seedTwoRuns();

    const response = await app.request("/api/runs/latest");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: latestId,
      kind: "demo",
      createdAt: latestRunAt.toISOString(),
      finishedAt: null,
    });
  });

  it("returns that run's units in sequence order", async () => {
    await seedTwoRuns();

    const response = await app.request("/api/runs/latest");

    expect(await response.json()).toMatchObject({
      units: [
        { seq: 1, status: "done" },
        { seq: 2, status: "failed" },
        { seq: 3, status: "pending" },
      ],
    });
  });

  /**
   * The `WHERE` is the assertion. Five units exist and only the latest run's three may
   * come back: a query that reads every unit in the table answers with five, and an
   * ordering that hid the mistake by sorting them plausibly still answers with five.
   */
  it("returns only the units of that run, never another run's", async () => {
    await seedTwoRuns();

    const response = await app.request("/api/runs/latest");
    const body = (await response.json()) as { units: readonly { seq: number }[] };

    expect(body.units).toHaveLength(3);
    expect(body.units.map(({ seq }) => seq)).toEqual([1, 2, 3]);
  });

  it("answers 404 when no run has been created yet", async () => {
    const response = await app.request("/api/runs/latest");

    expect(response.status).toBe(404);
  });
});

describe("POST /api/runs", () => {
  const createThreeUnits = async (): Promise<Response> =>
    app.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "demo", units: 3 }),
    });

  it("creates the run and answers with its id", async () => {
    const response = await createThreeUnits();

    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const rows = await testDb.select().from(run);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, kind: "demo", finishedAt: null });
  });

  it("creates as many units as the body asked for, numbered from one and all pending", async () => {
    const response = await createThreeUnits();
    const created = (await response.json()) as { id: string };

    const units = await testDb.select().from(runUnit);

    expect(units).toHaveLength(3);
    expect(units.map(({ seq }) => seq).sort()).toEqual([1, 2, 3]);
    expect(units.every(({ runId }) => runId === created.id)).toBe(true);
    expect(units.every(({ status }) => status === "pending")).toBe(true);
  });

  /**
   * A run with none of its units is a state the reader can do nothing with, so the two
   * writes are one transaction. The failure is forced from inside the database, by a
   * trigger that refuses every `run_unit` insert, because nothing the request can carry
   * makes a well-formed unit insert fail. If the handler dropped its transaction, the
   * run row would survive its units' failure and this test would find one.
   */
  it("writes the run and its units as one transaction, or neither", async () => {
    // One statement per call: a prepared statement carries exactly one.
    await testDb.execute(
      sql`create function refuse_units() returns trigger language plpgsql as
        $$ begin raise exception 'no unit may be written'; end $$`,
    );
    await testDb.execute(
      sql`create trigger refuse_units before insert on run_unit
        for each row execute function refuse_units()`,
    );

    try {
      const response = await createThreeUnits();
      expect(response.status).toBe(500);
    } finally {
      await testDb.execute(sql`drop trigger refuse_units on run_unit`);
      await testDb.execute(sql`drop function refuse_units()`);
    }

    expect(await testDb.select().from(run)).toHaveLength(0);
    expect(await testDb.select().from(runUnit)).toHaveLength(0);
  });
});
