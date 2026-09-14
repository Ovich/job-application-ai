import { z } from "zod";

/**
 * What an entry of a conversation is made of (`ID161`, the spec's *The entry*): an
 * ordered list of parts, a closed and additive union validated with zod by every writer.
 *
 * The vocabulary is neutral: nothing here names a model provider. `text` came first;
 * `tool_use` and `tool_result` joined at SL4 and the questions' parts (SL5) join the same
 * union. Adding a part does not move `catalogueVersion`; renaming or removing one would,
 * and neither is ever done.
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

/**
 * A call the model made (`SL4`): the call's id, which its result answers, the tool's
 * name, the input as the model passed it, parsed, and the arguments string exactly as the
 * model wrote it (`ID206`), which is what is sent back to it: a provider's prompt cache
 * keys on the bytes, and a `jsonb` column keeps neither key order nor spacing.
 */
export const toolUsePart = z.object({
  kind: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  arguments: z.string().optional(),
});

/**
 * What a call did (`SL4`): the call's id and the tool's name, and either the thing it
 * changed before and after, or the reason it was refused. Never both, never neither.
 */
export const toolResultPart = z
  .object({
    kind: z.literal("tool_result"),
    id: z.string().min(1),
    name: z.string().min(1),
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    refused: z.string().optional(),
  })
  .refine(
    (result) =>
      result.refused === undefined
        ? result.before !== undefined && result.after !== undefined
        : result.before === undefined && result.after === undefined,
    "a tool_result carries before and after, or a refusal",
  );

export const part = z.discriminatedUnion("kind", [textPart, toolUsePart, toolResultPart]);

/** A part as it is read: one the catalogue knows, or one from a catalogue it does not. */
export type Part = z.infer<typeof part> | { kind: string; [key: string]: unknown };

export const parts = z.array(part);
