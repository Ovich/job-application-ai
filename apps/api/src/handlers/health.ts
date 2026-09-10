import { sql } from "drizzle-orm";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { db } from "../lib/db";
import { createEnvelope } from "../lib/stream";

const factory = createFactory();

/**
 * The health route. It is the operator check and the pipeline's, and it is the one
 * route written here that will still be here when the product is finished (D20): after
 * every deploy it proves the same three things the run skeleton was invented to prove —
 * a merge reached the cloud, the database answers, a stream survives the distribution.
 *
 * It reports on the environment and never on a person. Rule 18 allows `select
 * version()` because the answer is a property of the engine; nothing else about the
 * database, the request or the account is said here.
 */

/** What `select version()` answers: one row, one column. */
type Version = { version: string };

/**
 * The rows of a raw result, whichever driver produced them. Drizzle hands a query
 * builder's rows back the same shape everywhere, but `execute` gives back what the
 * driver gave: postgres-js an array, PGlite an object with `rows` on it. This route is
 * the only place in the API that runs raw SQL, and the tests run on the driver the
 * deployed function does not, so the difference is read here rather than papered over
 * with a substitute database that would prove less.
 */
const rowsOf = (result: unknown): Version[] => {
  if (Array.isArray(result)) {
    return result as Version[];
  }
  if (typeof result === "object" && result !== null && "rows" in result) {
    return (result as { rows: Version[] }).rows;
  }
  return [];
};

/**
 * Whether the environment is up, answered by the database itself. A route that reported
 * "ok" without a query would go on reporting it through an outage, so the body carries
 * the engine's own version string: a value no handler could have invented.
 *
 * A database that cannot be reached is a 503 — the environment is unavailable — rather
 * than a 500, which would say this route is broken, and rather than an unhandled
 * rejection, which would take the request with it. Why it failed is not in the answer:
 * a connection error carries the host and the user it was refused for.
 */
export const readHealth = factory.createHandlers(async (c) => {
  try {
    const [row] = rowsOf(await db.execute(sql`select version()`));
    if (!row) {
      return c.json({ status: "unavailable" }, 503);
    }
    return c.json({ status: "ok", database: row.version }, 200);
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
});

/**
 * How often the stream says something. Well inside the thirty seconds a distribution
 * waits on an origin that has fallen silent, and far enough apart that a reader can
 * tell beats arriving one at a time from a response collected into one lump somewhere
 * between the function and it — which is the failure this stream exists to catch. A
 * second rather than the envelope's own fifteen: a check that watches this stream is
 * paid for in wall-clock time, and the stream is bounded and opened by checks alone.
 */
export const healthBeatIntervalMs = 1_000;

/**
 * How long one stream lasts before it ends itself. A probe is opened by a check, and a
 * check can be interrupted between opening the connection and closing it; without a
 * bound, such a reader would hold a function for the fifteen minutes the platform
 * allows and be paid for. Two minutes is far past any timeout between a browser and the
 * function, so nothing that watches this stream ever sees the end of it by accident.
 */
export const healthStreamMs = 120_000;

/**
 * How often a wait looks up to see whether anyone is still listening. A stream that
 * only ever slept for a whole beat would go on beating into a dead socket for as long
 * as that beat lasted, and would leave a finished test holding a timer.
 */
const abortCheckMs = 250;

/** What a wait needs of the response it is waiting inside: the sleep, and the two ways a
 * stream can already be over. Narrower than the streaming API on purpose. */
type Pausable = {
  sleep: (ms: number) => Promise<unknown>;
  readonly aborted: boolean;
  readonly closed: boolean;
};

/** Waits, and says whether it is still worth going on. `false` means the client left. */
const pause = async (response: Pausable, ms: number): Promise<boolean> => {
  for (let waited = 0; waited < ms; waited += abortCheckMs) {
    if (response.aborted || response.closed) {
      return false;
    }
    await response.sleep(Math.min(abortCheckMs, ms - waited));
  }
  return !(response.aborted || response.closed);
};

/**
 * A stream that says the same thing at a steady pace, so that what is measured is the
 * arrival rather than the content: a response buffered anywhere along the way still
 * ends with the same frames in the reader's hands.
 *
 * It writes through the envelope and never to the response itself, so the wire format,
 * the numbering and the keep-alive have exactly one owner (ID11) — and the envelope has
 * a caller on `main`, which is what keeps it from being dead code itself (D20). A beat
 * is a `text` leaf, a shape the catalogue already carries, so nothing about the
 * catalogue moves for this route.
 */
export const streamHealth = factory.createHandlers(async (c) => {
  // The raw stream helper rather than the server-sent-event one: the envelope already
  // writes `id:` and `data:` lines and the SSE helper would prefix them again. So the
  // headers that helper sets are set here instead. `x-accel-buffering` asks a reverse
  // proxy not to collect the response into one lump, which is the failure the deployed
  // spec measures.
  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("x-accel-buffering", "no");

  return stream(c, async (response) => {
    const envelope = createEnvelope(async (chunk) => {
      await response.write(chunk);
    });
    // A reader that navigates away leaves a heartbeat armed, which would go on writing
    // into a dead socket for as long as the container lived.
    response.onAbort(() => {
      envelope.close();
    });

    try {
      const endsAt = Date.now() + healthStreamMs;
      // The first beat leaves before any wait, so a reader knows the stream is open
      // rather than pending, and the distribution has something to forward at once.
      for (let beat = 1; Date.now() < endsAt; beat += 1) {
        await envelope.send({ kind: "text", text: `beat ${beat}` });
        if (!(await pause(response, healthBeatIntervalMs))) {
          break;
        }
      }
    } finally {
      envelope.close();
    }
  });
});
