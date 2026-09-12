import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CaseName } from "../types";

/**
 * The recorded cases, and the loader that finds one.
 *
 * A case is one hand-authored JSON file under `lib/ai/fixtures/<feature>/`, namespaced
 * by feature so the builder's cases and the letter's join the intake's later without a
 * second double (ID112, D15). They are expected to be many, and they are written
 * against documents the person actually has, so what a case says is what a reader
 * should get out of a real file.
 *
 * **Nothing in a fixture names a protocol.** A case holds the content once and the two
 * serialisers wrap it, which is the whole of D11: the day a provider is reached in
 * Anthropic's shape, the recorded cases do not move.
 *
 * This module reads files and nothing else. It imports no client and can open no
 * connection, which is what makes a miss a failure rather than a call (spec D20).
 */

/**
 * A case's file, minus what its name already says. `usage` is written in the
 * envelope-independent names — input and output — and each serialiser maps them into
 * what its own protocol calls them.
 */
const recordedCase = z.object({
  case: z.string().regex(/^[^.]+\.[^:]+:.+$/, "a case is named <feature>.<step>:<input>"),
  stands_for: z.string().min(1),
  content: z.string(),
  tool_calls: z.array(z.unknown()).default([]),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .default({ input_tokens: 0, output_tokens: 0 }),
});

/** One recorded case, as the loader hands it on. */
export type RecordedCase = z.infer<typeof recordedCase> & { case: CaseName };

/**
 * One recorded case as a file holds it, where the counts and the tool calls may be left
 * out and the loader fills them in. It is what a person hand-authoring a fixture writes,
 * and what the suite's `withCases` takes.
 */
export type RecordedCaseFile = z.input<typeof recordedCase>;

/** The tree the product ships: `apps/api/src/lib/ai/fixtures/`. */
const shipped = fileURLToPath(new URL("../fixtures/", import.meta.url));

let root = shipped;

/**
 * Points the loader at another tree, and hands back the one it was using.
 *
 * The suite's own support calls this and puts it back (`tests/support/ai.ts`), so a
 * test can record a case of its own without adding a file to the product's tree.
 * Nothing in the product calls it.
 */
export const useFixtureRoot = (path: string): string => {
  const previous = root;
  root = path;
  return previous;
};

/**
 * Every case in the tree, read fresh. A double that caches is a double that answers
 * yesterday's fixture after one is edited, and the cost of reading a directory of small
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
    const read = recordedCase.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!read.success) {
      throw new Error(`The recorded case ${path} is not a case: ${read.error.message}`);
    }
    held.set(read.data.case, read.data as RecordedCase);
  }
  return held;
};

/** The cases the mock holds, sorted, for the 404's body and for a test's own listing. */
export const casesHeld = (): CaseName[] => [...everyCase().keys()].sort() as CaseName[];

/** The case asked for, or nothing. Nothing is a 404; it is never a call and never a guess. */
export const caseNamed = (name: string | null | undefined): RecordedCase | undefined =>
  name === null || name === undefined ? undefined : everyCase().get(name);
