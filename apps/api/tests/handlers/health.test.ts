import { describe, expect, it, vi } from "vitest";

/**
 * The health route: the one thing the pipeline asks after every deploy, and the only
 * route on `main` that will still be there when the product is finished (D20).
 *
 * It answers three questions and they are the three the foundation was ever proving: a
 * merge reached the cloud, the database answers, a stream survives what stands between
 * the function and the reader. Here the first two are asked of a real PostgreSQL in
 * this process and the third of the handler's own frames; the deployed half — through
 * the distribution — is `e2e/health.spec.ts` and `e2e/health-stream.spec.ts`.
 */
vi.mock("../../src/lib/db", async () => ({ db: (await import("../support/database")).testDb }));

/**
 * What each envelope the handler opened was asked to do, in the order it was opened.
 * The envelope itself is the real one — the frames below are the frames a reader gets —
 * and this only counts, so that "the handler stopped when the client left" becomes a
 * thing a test can see rather than a thing a comment claims.
 */
type Watched = { sends: number; closed: boolean };
const watched: Watched[] = [];

vi.mock("../../src/lib/stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/stream")>();
  return {
    ...actual,
    createEnvelope: (write: Parameters<typeof actual.createEnvelope>[0], options?: unknown) => {
      const envelope = actual.createEnvelope(
        write,
        options as Parameters<typeof actual.createEnvelope>[1],
      );
      const record: Watched = { sends: 0, closed: false };
      watched.push(record);
      return {
        send: async (leaf: unknown) => {
          record.sends += 1;
          return await envelope.send(leaf);
        },
        close: () => {
          record.closed = true;
          envelope.close();
        },
      };
    },
  };
});

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { catalogueVersion } = await import("../../src/lib/stream");
const { healthBeatIntervalMs, healthStreamMs } = await import("../../src/handlers/health");

/** How long a distribution waits on an origin that is saying nothing (`infra/App-dev.yaml`). */
const originReadTimeoutMs = 30_000;

describe("GET /api/health", () => {
  it("answers with the database's own answer, so a route that never queried fails here", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; database: string };
    expect(body.status).toBe("ok");
    // What `select version()` answers, and nothing a handler could have made up.
    expect(body.database).toContain("PostgreSQL");
  });

  /**
   * Rule 18. The check is the whole body rather than a search for one forbidden word:
   * a field added later that carries a name, an email or a document's text fails here
   * on the day it is added, which a search for today's mistakes would not.
   */
  it("says nothing but the outcome and the engine's version", async () => {
    const response = await app.request("/api/health");

    expect(Object.keys((await response.json()) as object).sort()).toEqual(["database", "status"]);
  });

  /**
   * A database that cannot be reached is a health route answering "not healthy", which
   * is a 503: an operator, a probe and a pipeline all read that as the environment
   * being down. A 500 would read as the route itself being broken, and an unhandled
   * rejection would take the function with it.
   */
  it("answers 503 when the database cannot be reached, and leaks nothing of why", async () => {
    const refusing = vi
      .spyOn(testDb, "execute")
      .mockRejectedValueOnce(new Error("connection refused for user jobapp at db.example"));

    try {
      const response = await app.request("/api/health");

      expect(response.status).toBe(503);
      const said = JSON.stringify(await response.json());
      expect(said).toContain("unavailable");
      expect(said).not.toContain("jobapp");
      expect(said).not.toContain("db.example");
    } finally {
      refusing.mockRestore();
    }
  });

  it("really did ask the database, once, for its version", async () => {
    const asking = vi.spyOn(testDb, "execute");

    try {
      await app.request("/api/health");

      expect(asking).toHaveBeenCalledTimes(1);
      // The SQL Drizzle was handed, read as the chunks it is made of rather than as a
      // string: `SQL` has no `toString`, and `[object Object]` contains anything.
      expect(JSON.stringify(asking.mock.calls[0]?.[0])).toContain("version()");
    } finally {
      asking.mockRestore();
    }
  });
});

describe("GET /api/health/stream", () => {
  /** One frame as it left the envelope, parsed back out of the wire format. */
  type Frame = {
    seq: number;
    version: number;
    leaf: { kind: string; text?: string };
  };

  /** The frames in what a stream has said so far; a block with no `data:` line is a beat comment. */
  const framesIn = (said: string): Frame[] =>
    said
      .split("\n\n")
      .flatMap((block) => block.split("\n").filter((line) => line.startsWith("data: ")))
      .map((line) => JSON.parse(line.slice("data: ".length)) as Frame);

  /** One read of the stream, held open until it is let go of. */
  type Listening = {
    readonly frames: () => Frame[];
    /** When each frame landed, in milliseconds since the read began. */
    readonly arrivals: () => number[];
    readonly envelope: () => Watched;
    readonly cancel: () => Promise<void>;
  };

  /**
   * Opens the stream and keeps reading it in the background. Cancelling is what a
   * closed laptop does to the connection, and the handler is expected to notice.
   */
  const listen = async (): Promise<Listening> => {
    const opened = watched.length;
    const response = await app.request("/api/health/stream");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = response.body;
    if (!body) {
      throw new Error("the stream had no body");
    }

    const startedAt = Date.now();
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let said = "";
    let seen: Frame[] = [];
    const at: number[] = [];
    const pumping = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        said += decoder.decode(value, { stream: true });
        const frames = framesIn(said);
        while (at.length < frames.length) {
          at.push(Date.now() - startedAt);
        }
        seen = frames;
      }
    })().catch(() => undefined);

    return {
      frames: () => seen,
      arrivals: () => at,
      envelope: () => {
        const record = watched[opened];
        if (!record) {
          throw new Error("the handler opened no envelope");
        }
        return record;
      },
      cancel: async () => {
        await reader.cancel().catch(() => undefined);
        await pumping;
      },
    };
  };

  /** Waits, without pretending to be anything else. */
  const after = async (ms: number): Promise<void> =>
    await new Promise((resolve) => setTimeout(resolve, ms));

  it("beats through the envelope, so the wire format has one owner and one caller", async () => {
    const listening = await listen();

    try {
      await after(healthBeatIntervalMs / 2);
      const [first] = listening.frames();

      // A text leaf, which the catalogue already carries: a heartbeat needs no new
      // shape and therefore no new catalogue version.
      expect(first).toMatchObject({ seq: 1, version: catalogueVersion, leaf: { kind: "text" } });
      expect(listening.envelope().sends).toBe(1);
    } finally {
      await listening.cancel();
    }
  });

  /**
   * The property the old idle spec measured, and the reason the route exists: a stream
   * that is quiet is still a stream that is alive. Beats spread over time are what a
   * buffering layer collapses into one lump and what an origin read timeout kills.
   */
  it("beats spread over time, not in one lump", async () => {
    const listening = await listen();

    try {
      await after(healthBeatIntervalMs * 2.5);
      const arrivals = listening.arrivals();

      expect(arrivals.length).toBeGreaterThanOrEqual(3);
      expect((arrivals.at(2) ?? 0) - (arrivals.at(0) ?? 0)).toBeGreaterThan(
        healthBeatIntervalMs * 1.5,
      );
      // Numbered from one, ascending, as every stream on this wire is.
      expect(listening.frames().map(({ seq }) => seq)).toEqual(
        listening.frames().map((_frame, index) => index + 1),
      );
    } finally {
      await listening.cancel();
    }
  });

  /**
   * A browser that navigates away leaves the connection cut and nothing else. If the
   * handler went on beating, an abandoned stream would hold a timer for as long as the
   * container lived and would write into a dead socket every few seconds.
   */
  it("stops beating and closes the envelope when the client goes", async () => {
    const listening = await listen();
    await after(healthBeatIntervalMs / 2);
    const beatsWhileWatching = listening.envelope().sends;

    await listening.cancel();
    await after(healthBeatIntervalMs * 2);

    expect(listening.envelope().closed).toBe(true);
    expect(listening.envelope().sends).toBe(beatsWhileWatching);
  });

  it("beats well inside the time a distribution waits on a silent origin", () => {
    expect(healthBeatIntervalMs).toBeLessThan(originReadTimeoutMs);
    // And the stream ends by itself, so a reader that walks away without closing its
    // connection cannot hold a function for the fifteen minutes the platform allows.
    expect(healthStreamMs).toBeGreaterThan(originReadTimeoutMs);
    expect(healthStreamMs).toBeLessThanOrEqual(5 * 60_000);
  });
});
