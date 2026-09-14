import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * The answer documents, and the loader that finds one (`ID147`, amending `ID112`; the
 * person's own comment: *"These documents shall be encapsulated in the mock module which
 * is responsable to route requests to a good response document. It should not be a
 * fixture"*).
 *
 * They live inside this module, under `documents/<feature>/`, and nothing outside it may
 * read them: they are this module's own data, not a test's furniture. Namespaced by
 * feature so the builder's answers and the letter's join the intake's later without a
 * second double, expected to be many, and written against documents the person actually
 * has — so what a document says is what a reader should get out of a real file (`D15`,
 * `D20`).
 *
 * **Nothing in an answer document names a protocol.** It holds the content once and the
 * two serialisers wrap it, which is the whole of `D11`: the day a provider is reached in
 * Anthropic's shape, these documents do not move.
 *
 * This module reads files and nothing else. It imports no client and can open no
 * connection, which is what makes a miss a failure rather than a call (spec `D20`).
 */

/**
 * One document, minus what its name already says. `usage` is written in the
 * envelope-independent names — input and output — and each serialiser maps them into
 * what its own protocol calls them.
 */
const answerDocument = z.object({
  case: z.string().regex(/^[^.]+\.[^:]+:.+$/, "a case is named <feature>.<step>:<input>"),
  stands_for: z.string().min(1),
  content: z.string(),
  /**
   * The step's calls, in a shape no protocol owns (`ID190`): each envelope wraps them as
   * its own. `arguments` is what the model passed, an object as a rule; a string is sent
   * as the protocol's own text, verbatim, which is how a case holds arguments that do
   * not parse.
   */
  tool_calls: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), arguments: z.unknown() }))
    .default([]),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .default({ input_tokens: 0, output_tokens: 0 }),
});

/** One answer document, as the loader hands it on. */
export type RecordedCase = z.infer<typeof answerDocument>;

/**
 * One answer document as a file holds it, where the counts and the tool calls may be
 * left out and the loader fills them in. It is what a person hand-authoring one writes,
 * and what the suite's `withCases` takes.
 */
export type RecordedCaseFile = z.input<typeof answerDocument>;

/** The tree this module ships: `apps/api/src/lib/mock/documents/`. */
const shipped = fileURLToPath(new URL("./documents/", import.meta.url));

let root = shipped;

/**
 * Points the loader at another tree for as long as the caller wants, and hands back the
 * undoing of it.
 *
 * The suite's own support calls this and undoes it (`tests/support/ai.ts`), so a test can
 * write an answer of its own without adding a file to this module's tree. Nothing in the
 * product calls it.
 */
export const withAnswersFrom = (directory: string): (() => void) => {
  const previous = root;
  root = directory;
  return () => {
    root = previous;
  };
};

/**
 * Every answer in the tree, read fresh. A module that caches is one that answers
 * yesterday's document after one is edited, and the cost of reading a directory of small
 * files on a laptop is not worth that.
 *
 * A file that does not parse throws with its own path in the message, because a broken
 * double must not look like a broken product.
 */
const everyCase = (): Map<string, RecordedCase> => {
  const held = new Map<string, RecordedCase>();
  let files: string[];
  try {
    files = readdirSync(root, { recursive: true, encoding: "utf8" });
  } catch {
    return held;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const path = join(root, file);
    const read = answerDocument.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!read.success) {
      throw new Error(`The answer document ${path} is not one: ${read.error.message}`);
    }
    held.set(read.data.case, read.data);
  }
  return held;
};

/** The cases this module answers, sorted, for a test's own listing. */
export const casesHeld = (): string[] => [...everyCase().keys()].sort();

/**
 * The case asked for, or nothing. Nothing is the placeholder answer (`ID166`); it is
 * never a call and never a guess.
 */
export const caseNamed = (name: string | null | undefined): RecordedCase | undefined =>
  name === null || name === undefined ? undefined : everyCase().get(name);
