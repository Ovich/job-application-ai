/**
 * A raw read of an event stream, from the test process rather than from a page.
 *
 * The web app is an empty shell (S9.1) and what the checks measure is the API's stream,
 * so the read is made here with the platform's `fetch` and a hand parse of the
 * event-stream format. Two things this sees that a page never could: the envelope's
 * heartbeat, which a browser hides as a comment; and the moment each byte arrives,
 * which is the measurement `e2e/health-stream.spec.ts` exists for. Playwright's
 * `request` fixture is not used for a stream because it hands back a body only once it
 * is complete, which is the one thing a stream must not be waited for.
 */

/** One frame as the reader received it: what the envelope said, without when. */
export type Frame = {
  readonly seq: number;
  readonly version: number;
  readonly kind: string;
  readonly text: string | null;
};

/** One frame and the moment it landed, in milliseconds since the read began. */
export type Arrival = {
  readonly at: number;
  readonly frame: Frame;
};

/** Everything one read saw. */
export type Reading = {
  readonly arrivals: readonly Arrival[];
  /** How many heartbeat comments arrived. Invisible to a browser; visible here. */
  readonly beats: number;
  /** Whether the server ended the stream before the reader stopped reading. */
  readonly ended: boolean;
};

/**
 * When the reader stops: after `frames` of them, when `until` says so of a frame, or
 * after `forMs` whatever arrived. Reaching the end of the stream stops it too.
 */
export type Stop =
  | { readonly frames: number }
  | { readonly until: (frame: Frame) => boolean }
  | { readonly forMs: number };

/** How long a stream may say nothing at all, beats included, before the read is a failure. */
const defaultSilenceMs = 15_000;

/** The wire shape the envelope writes (`apps/api/src/lib/stream/envelope.ts`). */
type WireFrame = {
  seq: number;
  version: number;
  leaf: { kind: string; text?: string };
};

const frameOf = (data: string): Frame => {
  const wire = JSON.parse(data) as WireFrame;
  return {
    seq: wire.seq,
    version: wire.version,
    kind: wire.leaf.kind,
    text: wire.leaf.text ?? null,
  };
};

/**
 * Opens the stream and answers with the response's opening: the status and the
 * content type, as `fetch` resolves on the headers. The body is let go unread, so the
 * run is left without a reader rather than pulled along by this probe.
 */
export const openStream = async (
  url: string,
): Promise<{ readonly status: number; readonly contentType: string | null }> => {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  const opening = { status: response.status, contentType: response.headers.get("content-type") };
  controller.abort();
  return opening;
};

/**
 * Reads the stream at `url` until `stop` says so, and closes the connection then. What
 * a closed laptop, a lost network and a reload all look like to the server is that the
 * response stops being read, and aborting the fetch is exactly that.
 *
 * The event-stream format is lines: `id:` and `data:` lines make an event, a blank
 * line ends it, and a line opening with a colon is a comment. The envelope writes one
 * frame per event and one comment per beat, so the parse here is no more than that.
 */
export const readStream = async (
  url: string,
  stop: Stop,
  options?: { readonly silenceMs?: number },
): Promise<Reading> => {
  const silenceMs = options?.silenceMs ?? defaultSilenceMs;
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (response.status !== 200 || response.body === null) {
    controller.abort();
    throw new Error(`the stream answered ${response.status} rather than opening`);
  }

  const startedAt = performance.now();
  const arrivals: Arrival[] = [];
  let beats = 0;
  let ended = false;
  let buffered = "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  return await new Promise<Reading>((resolve, reject) => {
    let guard: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      clearTimeout(guard);
      clearTimeout(deadline);
      controller.abort();
      resolve({ arrivals, beats, ended });
    };

    const fail = (reason: string) => {
      clearTimeout(guard);
      clearTimeout(deadline);
      controller.abort();
      reject(new Error(reason));
    };

    // Rearmed on every arrival, a beat included: a beat is the server saying it is
    // still there, which is what a guard against silence is asking.
    const rearm = () => {
      clearTimeout(guard);
      guard = setTimeout(() => fail(`the stream said nothing for ${silenceMs}ms`), silenceMs);
    };

    if ("forMs" in stop) {
      deadline = setTimeout(finish, stop.forMs);
    }

    const stopsAt = (frame: Frame): boolean =>
      ("frames" in stop && arrivals.length >= stop.frames) ||
      ("until" in stop && stop.until(frame));

    /** One complete event, its blank line already consumed. Says whether to stop. */
    const takeEvent = (event: string): boolean => {
      rearm();
      const lines = event.split("\n");
      if (lines.every((line) => line.startsWith(":"))) {
        beats += 1;
        return false;
      }
      const data = lines
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length)
        .trim();
      if (data === undefined) {
        return false;
      }
      const frame = frameOf(data);
      arrivals.push({ at: performance.now() - startedAt, frame });
      return stopsAt(frame);
    };

    const pump = async () => {
      rearm();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          finish();
          return;
        }
        buffered += decoder.decode(value, { stream: true });
        let boundary = buffered.indexOf("\n\n");
        while (boundary !== -1) {
          const event = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (takeEvent(event)) {
            finish();
            return;
          }
          boundary = buffered.indexOf("\n\n");
        }
      }
    };

    pump().catch((error: unknown) => {
      // The abort is the reader's own doing after `finish` or `fail`, not a failure.
      if (!controller.signal.aborted) {
        fail(`the stream failed: ${String(error)}`);
      }
    });
  });
};
