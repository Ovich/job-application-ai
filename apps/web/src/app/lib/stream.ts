/**
 * The product's stream envelope, read (`ID184`): the frames a server-sent-event body
 * carries, parsed, one at a time as they arrive.
 *
 * What it hides: the decoder, the chunk buffer, the blank line a frame ends on, the
 * heartbeat comments and the `id:` lines. A data line that does not parse is skipped and
 * never thrown, so one bad frame does not end a stream; a cut stream simply ends.
 *
 * It reads no global, only the body it is given. `AssistantCore` is its first reader;
 * the documents screen keeps its own loop in this slot.
 */

/** One frame as the API's envelope writes it. The leaf is the reader's to narrow. */
export type StreamFrame = { seq: number; version: number; leaf: unknown };

/** A frame's `data:` line, parsed, or `null` for a comment, a sentinel or a bad line. */
const frameIn = (block: string): StreamFrame | null => {
  const line = block.split("\n").find((each) => each.startsWith("data: "));
  if (line === undefined) return null;
  try {
    const read: unknown = JSON.parse(line.slice("data: ".length));
    return typeof read === "object" && read !== null && "leaf" in read
      ? (read as StreamFrame)
      : null;
  } catch {
    return null;
  }
};

export async function* framesOf(body: ReadableStream<Uint8Array>): AsyncIterable<StreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      held += decoder.decode(next.value, { stream: true });
      const blocks = held.split("\n\n");
      held = blocks.pop() ?? "";
      for (const block of blocks) {
        const frame = frameIn(block);
        if (frame !== null) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
