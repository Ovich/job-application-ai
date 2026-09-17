import { readFileSync } from "node:fs";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { profileEditTool } from "../../../src/lib/profile-edit";

/**
 * The edit tool's schema on the wire (S2.2, O18, spec 3.8): the schema `@langchain/core`
 * derives from `profileEditTool.input` is the one `run.test`'s snapshot holds, before
 * anything is built on the tool path.
 *
 * The snapshot is read from its file, the one `run.test` writes and checks, so this case
 * compares against what the suite holds rather than against a copy of it.
 */

const snapshotFile = new URL("./__snapshots__/run.test.ts.snap", import.meta.url);
const snapshotName =
  "every request (S4.4, ID181, ID193) > derives the edit tool's schema from profileEditTool's input, held by its snapshot 1";

/** The one entry, read back from Vitest's printed form: JSON with trailing commas. */
const heldSchema = (): unknown => {
  const exported: Record<string, string> = {};
  new Function("exports", readFileSync(snapshotFile, "utf8"))(exported);
  const printed = exported[snapshotName];
  if (printed === undefined) throw new Error(`no snapshot named ${snapshotName}`);
  return JSON.parse(printed.replace(/,(\s*[}\]])/g, "$1"));
};

describe("the edit tool's schema on the wire (O18)", () => {
  it("is, from @langchain/core, the schema run.test's snapshot holds", () => {
    expect(toJsonSchema(profileEditTool.input)).toEqual(heldSchema());
  });

  it("is, byte for byte, the schema zod derives today", () => {
    expect(JSON.stringify(toJsonSchema(profileEditTool.input))).toBe(
      JSON.stringify(z.toJSONSchema(profileEditTool.input)),
    );
  });
});
