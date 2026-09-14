import { z } from "zod";

/**
 * The stream module's envelope. It exposes the catalogue of leaves, the schema that
 * validates one, and an encoder that turns a leaf into a numbered frame on the wire.
 * It hides the sequence counter, the heartbeat timer and the server-sent-event format
 * itself, so no caller ever writes an `id:` line or decides what number a frame gets
 * (ID11).
 *
 * The invariant the whole module exists for: a frame is never emitted for a leaf the
 * catalogue rejects, and such a leaf spends no sequence. That is why `send` takes an
 * `unknown` rather than a `Leaf`. Validation is the boundary here, and a boundary that
 * only accepts values already proved valid is decoration; the type would also make the
 * rejection cases unwritable in a test.
 */

/**
 * Which catalogue wrote a frame. A stored or replayed frame still says which shape
 * vocabulary it was written against, so a browser reading an old stream can tell that
 * it is old rather than malformed. It moves when a leaf's shape changes, not when one
 * is added: adding is backwards compatible, changing is not.
 *
 * It stayed at 1 when the `progress` leaf was removed (SL10), which the rule above
 * would otherwise move. Nothing has ever stored a frame and no client has ever read
 * one: version 1 is the only catalogue any reader has seen, and it is the one `main`
 * declares. The next change to a leaf that a reader could hold moves it.
 */
export const catalogueVersion = 1;

/** A run of characters to append to what the page is showing. */
const textLeaf = z.object({
  kind: z.literal("text"),
  text: z.string(),
});

/**
 * One document of a reading run has moved (SL2, ID119). It carries the row's id and
 * where that row now stands, and nothing else: the kind, the language and the count are
 * columns, and the screen reads them back through the list route, which is also what
 * makes a reload agree with the stream. A frame is sent after the row is written, never
 * before, so a leaf a reader holds is a fact the database already carries.
 */
const documentLeaf = z.object({
  kind: z.literal("document"),
  id: z.string(),
  status: z.enum(["reading", "read", "failed"]),
  reason: z.string().nullable(),
});

/** The run itself is over. What follows is a screen that reads its rows, not a frame. */
const runLeaf = z.object({
  kind: z.literal("run"),
  status: z.literal("done"),
});

/**
 * One entry of a conversation, committed before its frame is sent (`ID170`, `ID196`), as
 * `GET /api/conversations/:assistant` answers it. A frame a reader holds is an entry the
 * database already carries, as the `document` leaf's rule has it.
 */
const entryLeaf = z.object({
  kind: z.literal("entry"),
  entry: z.object({
    id: z.string(),
    position: z.number().int().positive(),
    author: z.enum(["person", "assistant", "tool"]),
    parts: z.array(z.object({ kind: z.string() }).catchall(z.unknown())),
    createdAt: z.string(),
  }),
});

/**
 * What the agent is doing now, in a few words (`ID210`, spec `H27`): shown while a step
 * runs, never stored, gone once the reply's words land.
 */
const statusLeaf = z.object({ kind: z.literal("status"), text: z.string() });

/** A message's stream is over, every entry of it committed. */
const doneLeaf = z.object({ kind: z.literal("done") });

/** A message's stream ended on a failure: one sentence, and nothing half written. */
const errorLeaf = z.object({ kind: z.literal("error"), message: z.string() });

/**
 * Everything a stream may carry. A discriminated union, so an unknown kind is rejected
 * by the discriminator and a known kind with a missing field by its own shape.
 *
 * `text` was the only one until SL2, which is the slice that gave this module a second
 * caller: the intake's reading run reports a unit at a time, which is what the `progress`
 * leaf used to do before D20 removed it with the fake run it belonged to. These two are
 * that shape written against a real pipeline. The catalogue version does not move for
 * them: adding a leaf is backwards compatible and changing one is not.
 */
export const leafSchema = z.discriminatedUnion("kind", [
  textLeaf,
  documentLeaf,
  runLeaf,
  entryLeaf,
  statusLeaf,
  doneLeaf,
  errorLeaf,
]);

/** One thing a stream can say. Inferred from the catalogue, never listed twice. */
export type Leaf = z.infer<typeof leafSchema>;

/**
 * A leaf as it travels: what was said, where it sits in the stream, and which
 * catalogue said it. A wire shape rather than a row, so it may be written
 * here; nothing in the database knows about frames.
 */
export type Frame = {
  seq: number;
  version: number;
  leaf: Leaf;
};

/** How long a stream may stay silent before it says something anyway. Fifteen seconds
 * leaves room under a distribution's origin read timeout, which S3.7 verifies for real
 * through the deployed distribution rather than here. */
export const heartbeatIntervalMs = 15_000;

/** Where the envelope writes. Hono's stream write returns a promise, a test's sink does
 * not, and the envelope does not care which it was handed. */
type Write = (chunk: string) => void | Promise<void>;

/** What a caller holds: it sends leaves and it closes. The counter and the timer behind
 * these two functions are unreachable, which is the point of the module. */
export type Envelope = {
  send: (leaf: unknown) => Promise<Frame>;
  close: () => void;
};

/**
 * Opens an envelope over a write sink. `startAfter` is the last sequence a browser
 * says it saw, sent back as `Last-Event-ID` after a cut connection, so framing resumes
 * at the next one instead of repeating what the page already has.
 */
export const createEnvelope = (write: Write, options?: { startAfter?: number }): Envelope => {
  let lastSeq = options?.startAfter ?? 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const disarm = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const arm = () => {
    if (closed) return;
    // A fresh timeout per beat rather than one interval, because the countdown restarts
    // from the last thing written: a stream that is saying things needs no keep-alive.
    timer = setTimeout(beat, heartbeatIntervalMs);
  };

  const beat = () => {
    // A line opening with a colon is a comment in the event-stream format: it holds the
    // connection open and reaches the page as nothing at all, never as a leaf.
    void write(": beat\n\n");
    arm();
  };

  const send = async (leaf: unknown): Promise<Frame> => {
    // Throws before anything is written and before the counter moves, which is the
    // invariant: a rejected leaf leaves no gap in the sequence for a browser to resume
    // from and no half-event on the wire.
    const validated = leafSchema.parse(leaf);
    const frame: Frame = { seq: lastSeq + 1, version: catalogueVersion, leaf: validated };

    // The id is what a browser sends back after a cut connection, and the blank line is
    // what tells it the event is complete rather than still arriving.
    await write(`id: ${frame.seq}\ndata: ${JSON.stringify(frame)}\n\n`);

    lastSeq = frame.seq;
    disarm();
    arm();
    return frame;
  };

  const close = () => {
    closed = true;
    disarm();
  };

  arm();
  return { send, close };
};
