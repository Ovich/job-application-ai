import type { InferResponseType } from "hono/client";
import type { api } from "../lib/api";

/**
 * What arrives on a run's stream, and the one function that decides whether a given
 * event is any of it.
 *
 * Why these shapes are written here rather than imported. The RPC client carries the
 * shape of a *response body*, and an event body never passes through it: the streaming
 * route answers a `text/event-stream`, so `InferResponseType` knows a `Response` and
 * nothing about the frames inside it. The API does export `Frame` and `Leaf`, but only
 * behind its package's single entry point, which is the Hono application; reaching
 * past it would widen the API's public face from this side of the boundary and pull
 * more of that program into this one (ID26). Rule 5 allows this: a frame is a wire
 * shape, not a row, and it is exactly the kind of thing rule 5 names.
 *
 * One part of a leaf **is** a shape the database knows, and it is not written twice: a
 * unit's status is read off the client, where it arrives from the Drizzle enum through
 * `AppType` (rule 4). The day a status is added, `unitStatuses` below stops compiling.
 */

type LatestRun = InferResponseType<typeof api.runs.latest.$get, 200>;

/** What a unit of a run can be, as the schema says it, taken from the API's own answer. */
export type UnitStatus = LatestRun["units"][number]["status"];

/**
 * The statuses a stream may name, as a record rather than a list so the type checker
 * makes it exhaustive: a status the schema gains and this file has not heard of is a
 * compile error here, not a leaf silently dropped at runtime.
 */
const unitStatuses: Readonly<Record<UnitStatus, true>> = {
  pending: true,
  done: true,
  failed: true,
};

/**
 * The catalogue this page was written against. The version moves when a leaf's shape
 * changes, never when one is added, so a frame from another version is not something
 * to read optimistically: it is dropped, and the page goes on with what it can read.
 */
export const catalogueVersion = 1;

/** One thing a run says while it runs (ID33). */
export type StreamedLeaf =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "progress"; readonly seq: number; readonly status: UnitStatus };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The leaf inside one event, or `null` when there is none to be had: unparseable text,
 * another catalogue, a kind this page does not know, or a known kind whose fields are
 * not what the kind promises. The stream is the one input this application does not
 * control, so nothing here trusts its shape, and a frame that cannot be read costs the
 * page nothing but that frame.
 */
export function readLeaf(data: string): StreamedLeaf | null {
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(frame)) {
    return null;
  }
  const { version, leaf } = frame;
  if (version !== catalogueVersion || !isRecord(leaf)) {
    return null;
  }

  const { kind } = leaf;

  if (kind === "text") {
    const { text } = leaf;
    return typeof text === "string" ? { kind: "text", text } : null;
  }

  if (kind === "progress") {
    // A progress leaf's own sequence is the unit's place in the run, which is not the
    // frame's place in the stream: the two counters are independent (ID33).
    const { seq, status } = leaf;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      return null;
    }
    if (typeof status !== "string" || !Object.hasOwn(unitStatuses, status)) {
      return null;
    }
    return { kind: "progress", seq, status: status as UnitStatus };
  }

  return null;
}
