/**
 * One frame of a server-sent event stream, as either protocol puts it on the wire: an
 * event name where the protocol names its events, and the `data:` line.
 *
 * It is a plain shape rather than each serialiser's own, so the router paces and writes
 * frames without knowing which envelope produced them: the timing is one piece of code
 * and the two protocols differ only in what they hand it.
 */
export type Frame = {
  event?: string;
  data: string;
  /**
   * Whether this frame carries a piece of the answer. The wrappers a protocol opens and
   * closes with go out as fast as they are written; only the pieces are paced, because
   * only the pieces are what a model would have been generating.
   */
  paced?: boolean;
};
