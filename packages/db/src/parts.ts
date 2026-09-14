import { z } from "zod";

/**
 * What an entry of a conversation is made of (`ID161`, the spec's *The entry*): an
 * ordered list of parts, a closed and additive union validated with zod by every writer.
 *
 * The vocabulary is neutral: nothing here names a model provider. This slice holds only
 * `text`; `tool_use` and `tool_result` (SL4) and the questions' parts (SL5) join the same
 * union, and a part is never renamed or removed, which is what `catalogueVersion` counts.
 *
 * **A stored part whose kind the union does not know is kept on read, never thrown
 * away.** A writer parses; a reader does not, so an entry written by a later catalogue
 * reaches the screen whole and is drawn as a placeholder there (the spec's *Failure
 * modes*). That is why `Part` is wider than what `part` accepts.
 */
export const catalogueVersion = 1 as const;

/** Words. `scripted` is true when the product wrote them rather than a model (`ID200`). */
export const textPart = z.object({
  kind: z.literal("text"),
  text: z.string(),
  scripted: z.literal(true).optional(),
});

export const part = z.discriminatedUnion("kind", [textPart]);

/** A part as it is read: one the catalogue knows, or one from a catalogue it does not. */
export type Part = z.infer<typeof part> | { kind: string; [key: string]: unknown };

export const parts = z.array(part);
