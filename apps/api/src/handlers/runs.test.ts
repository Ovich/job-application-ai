import type { Run, RunUnit } from "@app/db";
import { run, runUnit } from "@app/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";

/**
 * The query layer stands in for the database, and it is deliberately not inert: an
 * ordered select sorts, an unordered one hands back the fixture in the order it was
 * given. That is what lets a fixture supplied out of order catch a handler that
 * forgets its `ORDER BY`. It ignores `where`, so a test must only ever load rows the
 * query under test is entitled to see.
 */
const { fakeDb, dbState } = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const state = {
    /** Rows a select of a given table resolves to. */
    selects: new Map<unknown, readonly Row[]>(),
    /** Rows an insert into a given table hands back from `returning()`. */
    returns: new Map<unknown, readonly Row[]>(),
    /** Every insert that was issued, in order. */
    inserts: [] as { table: unknown; values: readonly Row[] }[],
    /** Every table whose select asked the database for an ordering. */
    ordered: [] as unknown[],
    reset() {
      state.selects.clear();
      state.returns.clear();
      state.inserts.length = 0;
      state.ordered.length = 0;
    },
  };

  /** What the database would do under `ORDER BY`: units by sequence, runs newest first. */
  const inDatabaseOrder = (left: Row, right: Row): number => {
    const { seq: leftSeq, createdAt: leftCreatedAt } = left;
    const { seq: rightSeq, createdAt: rightCreatedAt } = right;
    if (typeof leftSeq === "number" && typeof rightSeq === "number") {
      return leftSeq - rightSeq;
    }
    if (leftCreatedAt instanceof Date && rightCreatedAt instanceof Date) {
      return rightCreatedAt.getTime() - leftCreatedAt.getTime();
    }
    return 0;
  };

  class SelectQuery implements PromiseLike<readonly Row[]> {
    #table: unknown;
    #limit: number | undefined;
    #ordered = false;

    from(table: unknown): this {
      this.#table = table;
      return this;
    }

    where(_condition: unknown): this {
      return this;
    }

    orderBy(..._order: unknown[]): this {
      this.#ordered = true;
      state.ordered.push(this.#table);
      return this;
    }

    limit(count: number): this {
      this.#limit = count;
      return this;
    }

    // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder is awaited directly, so the fake standing in for one is a thenable on purpose.
    then<TResult1 = readonly Row[], TResult2 = never>(
      onfulfilled?: ((value: readonly Row[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      const rows = [...(state.selects.get(this.#table) ?? [])];
      if (this.#ordered) {
        rows.sort(inDatabaseOrder);
      }
      const limit = this.#limit;
      return Promise.resolve(limit === undefined ? rows : rows.slice(0, limit)).then(
        onfulfilled,
        onrejected,
      );
    }
  }

  class InsertQuery implements PromiseLike<readonly Row[]> {
    readonly #table: unknown;

    constructor(table: unknown) {
      this.#table = table;
    }

    values(values: Row | Row[]): this {
      state.inserts.push({
        table: this.#table,
        values: Array.isArray(values) ? [...values] : [values],
      });
      return this;
    }

    returning(): this {
      return this;
    }

    // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder is awaited directly, so the fake standing in for one is a thenable on purpose.
    then<TResult1 = readonly Row[], TResult2 = never>(
      onfulfilled?: ((value: readonly Row[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      const rows = [...(state.returns.get(this.#table) ?? [])];
      return Promise.resolve(rows).then(onfulfilled, onrejected);
    }
  }

  const db = {
    select: (): SelectQuery => new SelectQuery(),
    insert: (table: unknown): InsertQuery => new InsertQuery(table),
    transaction: (callback: (tx: unknown) => unknown): unknown => callback(db),
  };

  return { fakeDb: db, dbState: state };
});

vi.mock("../lib/db", () => ({ db: fakeDb }));

const olderRun: Run = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "demo",
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  finishedAt: new Date("2026-09-01T10:00:30.000Z"),
};

const latestRun: Run = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "demo",
  createdAt: new Date("2026-09-08T10:00:00.000Z"),
  finishedAt: null,
};

const unitOf = (seq: number, status: RunUnit["status"]): RunUnit => ({
  runId: latestRun.id,
  seq,
  status,
  result: null,
  doneAt: null,
});

/** Out of order on purpose: a handler that leaves the ordering to chance must fail here. */
const latestRunUnits: readonly RunUnit[] = [
  unitOf(3, "pending"),
  unitOf(1, "done"),
  unitOf(2, "failed"),
];

beforeEach(() => {
  dbState.reset();
});

describe("GET /api/runs/latest", () => {
  it("returns the most recent run with its units ordered by sequence ascending", async () => {
    dbState.selects.set(run, [olderRun, latestRun]);
    dbState.selects.set(runUnit, latestRunUnits);

    const response = await app.request("/api/runs/latest");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: latestRun.id,
      kind: latestRun.kind,
      createdAt: latestRun.createdAt.toISOString(),
      finishedAt: null,
      units: [
        { seq: 1, status: "done" },
        { seq: 2, status: "failed" },
        { seq: 3, status: "pending" },
      ],
    });
  });

  it("asks the database for both orderings rather than sorting after the fact", async () => {
    dbState.selects.set(run, [olderRun, latestRun]);
    dbState.selects.set(runUnit, latestRunUnits);

    await app.request("/api/runs/latest");

    expect(dbState.ordered).toContain(run);
    expect(dbState.ordered).toContain(runUnit);
  });
});

describe("POST /api/runs", () => {
  const createdRun: Run = {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "demo",
    createdAt: new Date("2026-09-08T11:00:00.000Z"),
    finishedAt: null,
  };

  const createThreeUnits = async (): Promise<Response> => {
    dbState.returns.set(run, [createdRun]);
    return app.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "demo", units: 3 }),
    });
  };

  it("creates the run and answers with its id", async () => {
    const response = await createThreeUnits();

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: createdRun.id });

    const runInsert = dbState.inserts.find(({ table }) => table === run);
    expect(runInsert?.values).toMatchObject([{ kind: "demo" }]);
  });

  it("creates as many units as the body asked for, numbered from one and all pending", async () => {
    await createThreeUnits();

    const unitInsert = dbState.inserts.find(({ table }) => table === runUnit);
    const values = unitInsert?.values ?? [];

    expect(values).toHaveLength(3);
    expect(values.map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(values.map(({ runId }) => runId)).toEqual([createdRun.id, createdRun.id, createdRun.id]);
    // `pending` is the column's default, so a handler may write it or leave it out.
    expect(values.every(({ status }) => status === undefined || status === "pending")).toBe(true);
  });
});
