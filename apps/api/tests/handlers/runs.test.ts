import { run, runUnit } from "@app/db";
import { asc, eq, sql } from "drizzle-orm";
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
const { idleProbeKind, idleProbeUnitMs } = await import("../../src/handlers/runs");

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

describe("GET /api/runs/:id/stream", () => {
  /**
   * A run of one unit, of whatever kind, ready to be streamed.
   */
  const seedOneUnitRun = async (kind: string): Promise<string> => {
    const [created] = await testDb.insert(run).values({ kind }).returning();
    if (!created) {
      throw new Error("seeding a run returned no row");
    }
    await testDb.insert(runUnit).values({ runId: created.id, seq: 1 });
    return created.id;
  };

  /**
   * What the stream said in its first `ms`, then let go of it. Cancelling the reader is
   * what an abandoned browser does, and the handler stops the run on it, so a test never
   * leaves a run pacing itself in the background.
   */
  const heardWithin = async (id: string, ms: number): Promise<string> => {
    const response = await app.request(`/api/runs/${id}/stream`);
    expect(response.status).toBe(200);
    const body = response.body;
    if (!body) {
      throw new Error("the stream had no body");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let said = "";
    const listening = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        said += decoder.decode(value, { stream: true });
      }
    })().catch(() => undefined);

    await Promise.race([listening, new Promise((resolve) => setTimeout(resolve, ms))]);
    await reader.cancel();
    await listening;
    return said;
  };

  /** Long enough that an ordinary run has spoken several times over. */
  const listenMs = 700;

  it("has said something about the run well inside that time", async () => {
    const id = await seedOneUnitRun("demo");

    expect(await heardWithin(id, listenMs)).toContain('"kind":"progress"');
  });

  /**
   * The probe the deployed idle spec creates. It exists so that a stream can be watched
   * while it has nothing to say: the pace of such a run is longer than any timeout
   * between the browser and the function, so what holds the connection open for as long
   * as the spec watches is the heartbeat and nothing else. If this run spoke, the spec
   * would be measuring a stream that was busy, which proves nothing about a silent one.
   */
  it("says nothing at all for an idle probe, so only the heartbeat holds the connection", async () => {
    const id = await seedOneUnitRun(idleProbeKind);

    expect(await heardWithin(id, listenMs)).toBe("");
  });

  it("paces the idle probe past the timeout a distribution waits on a silent origin", () => {
    expect(idleProbeUnitMs).toBeGreaterThan(60_000);
  });
});

describe("GET /api/runs/:id/stream, resumed", () => {
  /** One frame as it left the envelope, parsed back out of the wire format. */
  type Frame = {
    seq: number;
    version: number;
    leaf: { kind: string; seq?: number; status?: string; text?: string };
  };

  /** How long a run of four units takes: four paces of 150 ms, plus room. */
  const wholeRunMs = 2_000;

  /**
   * How long two units read back out of the database may take to reach a reopened
   * client. Comfortably under one unit's pace, so a stream that produced them by doing
   * the units again cannot come in under it.
   */
  const replayMs = 100;

  /** A run of four units, all pending, ready to be streamed. */
  const seedFourUnitRun = async (): Promise<string> => {
    const [created] = await testDb.insert(run).values({ kind: "demo" }).returning();
    if (!created) {
      throw new Error("seeding a run returned no row");
    }
    await testDb
      .insert(runUnit)
      .values(Array.from({ length: 4 }, (_unit, index) => ({ runId: created.id, seq: index + 1 })));
    return created.id;
  };

  /** The frames in what a stream has said so far. A block with no `data:` line is a
   * heartbeat comment, and carries no frame. */
  const framesIn = (said: string): Frame[] =>
    said
      .split("\n\n")
      .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data: ")))
      .map((line) => JSON.parse(line.slice("data: ".length)) as Frame);

  /**
   * Listens to a run's stream and lets go of it. `after` is the sequence the client
   * says it already saw, `frames` how many frames to take before cutting the
   * connection: cutting is what a closed laptop does, and the handler stops the run on
   * it, so nothing is left pacing in the background.
   */
  const listen = async (
    id: string,
    options: { after?: number; frames?: number } = {},
  ): Promise<Frame[]> => {
    const query = options.after === undefined ? "" : `?after=${options.after}`;
    const response = await app.request(`/api/runs/${id}/stream${query}`);
    expect(response.status).toBe(200);
    const body = response.body;
    if (!body) {
      throw new Error("the stream had no body");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let said = "";
    let seen: Frame[] = [];
    const listening = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        said += decoder.decode(value, { stream: true });
        seen = framesIn(said);
        if (options.frames !== undefined && seen.length >= options.frames) {
          return;
        }
      }
    })().catch(() => undefined);

    await Promise.race([listening, new Promise((resolve) => setTimeout(resolve, wholeRunMs))]);
    await reader.cancel().catch(() => undefined);
    await listening;
    return seen;
  };

  /** The run's units as the database holds them, in sequence order. */
  const unitsOf = async (id: string) =>
    await testDb.select().from(runUnit).where(eq(runUnit.runId, id)).orderBy(asc(runUnit.seq));

  /**
   * The property the whole slice exists for. The connection is cut after the second
   * unit reported, and what the two finished units left behind is already in the
   * database: a run that wrote its results at the end would have nothing here.
   */
  it("has written each finished unit before the run is over", async () => {
    const id = await seedFourUnitRun();

    await listen(id, { frames: 4 });

    const units = await unitsOf(id);
    expect(units.map(({ status }) => status)).toEqual(["done", "done", "pending", "pending"]);
    expect(units[0]?.result).toBeTruthy();
    expect(units[0]?.doneAt).toBeInstanceOf(Date);
    expect(units[2]?.result).toBeNull();
    expect(units[2]?.doneAt).toBeNull();
  });

  /**
   * "After sequence N", the contract the envelope already chose: the client names the
   * last frame it saw and the next frame it receives is N + 1. Four frames is two
   * finished units, so the run carries on at the third.
   */
  it("resumes after the sequence the client names, at the first unit it has not seen", async () => {
    const id = await seedFourUnitRun();
    await listen(id, { frames: 4 });

    const resumed = await listen(id, { after: 4 });

    expect(resumed.at(0)?.seq).toBe(5);
    expect(resumed.at(0)?.leaf.kind).toBe("text");
    expect(resumed.map(({ leaf }) => leaf).filter(({ kind }) => kind === "progress")).toEqual([
      { kind: "progress", seq: 3, status: "done" },
      { kind: "progress", seq: 4, status: "done" },
    ]);
  });

  /**
   * The off-by-one this is where it hides. An odd sequence means the client saw a
   * unit's text and not its progress, so the progress is what it has not seen, and
   * repeating the text would put the same line on the page twice.
   */
  it("sends only the progress of a unit whose text the client already saw", async () => {
    const id = await seedFourUnitRun();
    await listen(id, { frames: 4 });

    const resumed = await listen(id, { after: 3 });

    expect(resumed.at(0)).toMatchObject({
      seq: 4,
      leaf: { kind: "progress", seq: 2, status: "done" },
    });
  });

  /**
   * A reopened page has seen nothing, so it receives the whole run: the units that
   * finished are replayed from what they wrote, exactly as they were said the first
   * time, and the run carries on from the first one that did not.
   *
   * The clock is the assertion that the replay is a replay. Two units read back out of
   * the database land in one another's tick; two units done again would take a pace
   * each, and would leave the same eight frames behind for a test that only compared
   * them.
   */
  it("replays the finished units without doing them again", async () => {
    const id = await seedFourUnitRun();
    const first = await listen(id, { frames: 4 });

    const startedAt = Date.now();
    const reopened = await listen(id, { after: 0, frames: 4 });

    expect(reopened).toEqual(first);
    expect(Date.now() - startedAt).toBeLessThan(replayMs);
  });

  /**
   * Two tabs on one run. The pair (run, sequence) is the primary key, so a unit is one
   * row whoever writes it, and the second writer finds the first one's result rather
   * than replacing it: the same row, the same `doneAt`, the same text on both pages.
   */
  it("cannot write a unit twice when two clients stream the same run", async () => {
    const id = await seedFourUnitRun();

    const [oneTab, otherTab] = await Promise.all([listen(id), listen(id)]);

    const units = await unitsOf(id);
    expect(units).toHaveLength(4);
    expect(units.every(({ status }) => status === "done")).toBe(true);
    expect(oneTab).toEqual(otherTab);
  });

  /** A run that has said everything has nothing left to say to a client that saw it all. */
  it("says nothing to a client that already saw the whole run", async () => {
    const id = await seedFourUnitRun();
    const whole = await listen(id);
    expect(whole).toHaveLength(8);

    expect(await listen(id, { after: 8 })).toEqual([]);
  });
});
