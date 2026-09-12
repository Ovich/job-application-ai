/**
 * How fast the double answers.
 *
 * A recorded answer that arrives all at once proves the envelope and hides everything
 * about time, and the reading screen and the assistant are watched behaving as they
 * will in production or not at all. So the mock paces an answer the way a model would,
 * and the pace is four named settings with defaults rather than a hard-coded delay
 * (spec D13): the dev server leaves them, the suite runs them at zero, and a test for a
 * slow or a stalled answer asks for one per request instead of reaching for a second
 * endpoint.
 *
 * Whatever the pace, the pieces joined equal the case's whole answer. The pace changes
 * timing and chunk boundaries, never content.
 */
export type Pace = {
  /** The pace of the answer once it starts. `0` means the whole answer in one chunk. */
  tokensPerSecond: number;
  /** The pause before the first chunk, where a real provider spends most of its latency. */
  timeToFirstTokenMs: number;
  /** How much arrives at a time, so a fast answer is not one chunk per character. */
  tokensPerChunk: number;
  /** A fraction of the interval, because a perfectly regular stream hides timing bugs. */
  jitter: number;
};

/** What a laptop gets when nothing says otherwise. */
export const defaultPace: Pace = {
  tokensPerSecond: 40,
  timeToFirstTokenMs: 400,
  tokensPerChunk: 3,
  jitter: 0.15,
};

/**
 * The per-request override. A real provider ignores a header it does not know, so a
 * request carrying it is still signature-identical to one that does not, which is the
 * same reasoning the case header rests on (ID111).
 */
export const paceHeader = "X-Jobapp-Mock-Pace";

/** The four names, as the header and the configuration value both spell them. */
const settings = {
  tps: "tokensPerSecond",
  ttft: "timeToFirstTokenMs",
  chunk: "tokensPerChunk",
  jitter: "jitter",
} as const satisfies Record<string, keyof Pace>;

/**
 * A pace read from `tps=8;ttft=1500;chunk=1;jitter=0`. A key the list does not name is
 * ignored, and so is a value that is not a number: the fallback answers for anything
 * unsaid, so a partial spec overrides only what it mentions and an unreadable one
 * changes nothing rather than stalling a stream on a typo.
 */
export const paceFrom = (spec: string | null | undefined, fallback: Pace): Pace => {
  const pace = { ...fallback };
  for (const pair of (spec ?? "").split(";")) {
    const [key, value] = pair.split("=").map((part) => part.trim());
    const setting = settings[key as keyof typeof settings];
    const read = Number(value);
    if (setting !== undefined && value !== undefined && value !== "" && Number.isFinite(read)) {
      pace[setting] = Math.max(0, read);
    }
  }
  return pace;
};

/** The pace this request asks for, or the configured one. */
export const paceOf = (headers: Headers, fallback: Pace): Pace =>
  paceFrom(headers.get(paceHeader), fallback);

/**
 * The recorded answer, split into the pieces it will arrive in.
 *
 * The split is on whitespace runs and non-whitespace runs, and the pieces are joined
 * with nothing, so concatenating them reproduces the content character for character —
 * the invariant the whole module is written around. At zero tokens per second there is
 * one piece, which is the whole answer.
 */
export const chunksOf = (content: string, pace: Pace): string[] => {
  if (content === "") return [];
  if (pace.tokensPerSecond <= 0) return [content];
  const size = Math.max(1, Math.floor(pace.tokensPerChunk));
  const tokens = content.match(/\s+|\S+/g) ?? [];
  const chunks: string[] = [];
  for (let at = 0; at < tokens.length; at += size)
    chunks.push(tokens.slice(at, at + size).join(""));
  return chunks;
};

/**
 * How long to wait between two pieces, jitter included. A perfectly regular stream
 * hides the timing bugs a real one finds, so the interval is nudged by a fraction of
 * itself; at zero jitter the nudge is nothing and the stream is exact.
 */
export const intervalMs = (pace: Pace): number => {
  if (pace.tokensPerSecond <= 0) return 0;
  const interval = (Math.max(1, Math.floor(pace.tokensPerChunk)) / pace.tokensPerSecond) * 1000;
  return Math.max(0, interval * (1 + (Math.random() * 2 - 1) * pace.jitter));
};
