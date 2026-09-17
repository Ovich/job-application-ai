import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { itemEducation, itemExperience, itemLine, profileItem, user } from "@app/db";
import { describe, expect, it } from "vitest";
import { apply, type Operation } from "../../../src/lib/profile-edit";
import { testDb } from "../../support/database";

/**
 * Seam B: `lib/profile-edit`, `apply` (`S4.2`, `ID168`, the spec's *The shared
 * profile-edit capability*).
 *
 * Behind it: PGlite with the real migrations, and the caller's transaction, which each
 * case opens itself as a caller would. The rows a case needs are planted here with ids
 * the case knows; nothing is read back from a table. What an item is, before and after,
 * is read through `apply`'s own result — and an edit of no operations is how a case reads
 * an item as it stands.
 */

type Planted = {
  person: string;
  post: string;
  lines: [string, string, string];
  child: string;
  diploma: string;
  diplomaLine: string;
};

/** A person with a post of three lines and one project under it, and a diploma with a line. */
const planted = async (): Promise<Planted> => {
  const person = randomUUID();
  await testDb.insert(user).values({ id: person, name: "Someone", email: `${person}@example.com` });

  const post = randomUUID();
  await testDb.insert(profileItem).values({
    id: post,
    userId: person,
    kind: "experience",
    title: "Platform engineer",
    subtitle: "Cloud team",
    startText: "Feb 2021",
    endText: "Dec 2024",
    position: 0,
  });
  await testDb.insert(itemExperience).values({
    itemId: post,
    organisation: "Nexplore",
    organisationNote: null,
    location: "Zurich",
    arrangement: null,
  });
  const lines: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  const texts = [
    "Ran the services on Kubernetes.",
    "Designed and shipped the internal developer platform used by every team in the company.",
    "Wrote the on-call runbooks.",
  ];
  for (const [at, id] of lines.entries()) {
    await testDb.insert(itemLine).values({ id, itemId: post, text: texts[at] ?? "", position: at });
  }

  const child = randomUUID();
  await testDb.insert(profileItem).values({
    id: child,
    userId: person,
    kind: "project",
    parentId: post,
    title: "Developer portal",
    position: 0,
  });

  const diploma = randomUUID();
  await testDb.insert(profileItem).values({
    id: diploma,
    userId: person,
    kind: "education",
    title: "Bachelor in computer science",
    position: 1,
  });
  await testDb.insert(itemEducation).values({ itemId: diploma, institution: "HEIG-VD" });
  const diplomaLine = randomUUID();
  await testDb
    .insert(itemLine)
    .values({ id: diplomaLine, itemId: diploma, text: "Thesis on scheduling.", position: 0 });

  return { person, post, lines, child, diploma, diplomaLine };
};

/** The post as it was planted, in the shape `apply` answers. */
const thePost = (at: Planted) => ({
  id: at.post,
  kind: "experience",
  title: "Platform engineer",
  subtitle: "Cloud team",
  startText: "Feb 2021",
  endText: "Dec 2024",
  block: {
    organisation: "Nexplore",
    organisationNote: null,
    location: "Zurich",
    arrangement: null,
  },
  lines: [
    { id: at.lines[0], text: "Ran the services on Kubernetes." },
    {
      id: at.lines[1],
      text: "Designed and shipped the internal developer platform used by every team in the company.",
    },
    { id: at.lines[2], text: "Wrote the on-call runbooks." },
  ],
  children: [{ id: at.child, kind: "project", title: "Developer portal" }],
});

/** One edit, in a transaction of its own that commits. */
const edited = (person: string, itemId: string, operations: Operation[]) =>
  testDb.transaction((tx) => apply(tx, person, itemId, operations));

/** The item as it stands, read through `apply` with no operation. */
const standing = async (person: string, itemId: string) => {
  const read = await edited(person, itemId, []);
  if ("refused" in read) throw new Error(`the item could not be read: ${read.refused}`);
  return read.after;
};

describe("each operation, applied (S4.2)", () => {
  it("sets a spine field, and nothing else moves", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "set", field: "title", value: "Senior platform engineer" },
    ]);

    expect(result).toEqual({
      before: thePost(at),
      after: { ...thePost(at), title: "Senior platform engineer" },
    });
  });

  it("sets a field of the kind's own block", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "set", field: "location", value: "Lausanne" },
    ]);

    expect(result).toEqual({
      before: thePost(at),
      after: { ...thePost(at), block: { ...thePost(at).block, location: "Lausanne" } },
    });
  });

  it("replaces one line's text, keeping the line", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "replace_line", lineId: at.lines[1], text: "Shipped the developer platform." },
    ]);

    const [first, , third] = thePost(at).lines;
    expect(result).toEqual({
      before: thePost(at),
      after: {
        ...thePost(at),
        lines: [first, { id: at.lines[1], text: "Shipped the developer platform." }, third],
      },
    });
  });

  it("adds a line at a position, and the later lines move down", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "add_line", position: 1, text: "Led the move to Kubernetes." },
    ]);

    if ("refused" in result) throw new Error(result.refused);
    expect(result.before).toEqual(thePost(at));
    expect(result.after.lines.map((line) => line.text)).toEqual([
      "Ran the services on Kubernetes.",
      "Led the move to Kubernetes.",
      "Designed and shipped the internal developer platform used by every team in the company.",
      "Wrote the on-call runbooks.",
    ]);
    expect(result.after.lines.map((line) => line.id)).toEqual([
      at.lines[0],
      expect.any(String),
      at.lines[1],
      at.lines[2],
    ]);
    expect(await standing(at.person, at.post)).toEqual(result.after);
  });

  it("removes one line", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [{ op: "remove_line", lineId: at.lines[0] }]);

    const [, second, third] = thePost(at).lines;
    expect(result).toEqual({
      before: thePost(at),
      after: { ...thePost(at), lines: [second, third] },
    });
  });

  it("removes one child item", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [{ op: "remove_child", childId: at.child }]);

    expect(result).toEqual({ before: thePost(at), after: { ...thePost(at), children: [] } });
  });

  it("answers the after that the item, read again through apply, still is", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "set", field: "endText", value: "today" },
      { op: "replace_line", lineId: at.lines[2], text: "Wrote the runbooks." },
    ]);

    if ("refused" in result) throw new Error(result.refused);
    expect(await standing(at.person, at.post)).toEqual(result.after);
  });
});

describe("each operation, refused (S4.2, the spec's Failure modes)", () => {
  it("refuses a field the item's kind has not", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "set", field: "institution", value: "EPFL" },
    ]);

    expect(result).toEqual({ refused: expect.stringContaining("institution") });
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });

  it("refuses emptying a field the item cannot be without", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "set", field: "organisation", value: null },
    ]);

    expect(result).toEqual({ refused: expect.stringContaining("organisation") });
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });

  it("refuses replacing a line of another item", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "replace_line", lineId: at.diplomaLine, text: "Taken over." },
    ]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
    expect((await standing(at.person, at.diploma)).lines).toEqual([
      { id: at.diplomaLine, text: "Thesis on scheduling." },
    ]);
  });

  it("refuses removing a line of another item", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "remove_line", lineId: at.diplomaLine },
    ]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect((await standing(at.person, at.diploma)).lines).toHaveLength(1);
  });

  it("refuses adding a line past the end", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [
      { op: "add_line", position: 4, text: "Nowhere." },
    ]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });

  it("refuses removing an item that is not its child", async () => {
    const at = await planted();

    const result = await edited(at.person, at.post, [{ op: "remove_child", childId: at.diploma }]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect((await standing(at.person, at.diploma)).title).toBe("Bachelor in computer science");
  });

  it("refuses an item of another person, and changes nothing of it", async () => {
    const at = await planted();
    const other = await planted();

    const result = await edited(other.person, at.post, [
      { op: "set", field: "title", value: "Taken over" },
    ]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });

  it("refuses the whole edit when one line of three operations no longer exists, and applies none", async () => {
    const at = await planted();
    await edited(at.person, at.post, [{ op: "remove_line", lineId: at.lines[1] }]);
    const before = await standing(at.person, at.post);

    const result = await edited(at.person, at.post, [
      { op: "set", field: "title", value: "Senior platform engineer" },
      { op: "replace_line", lineId: at.lines[1], text: "Shipped the developer platform." },
      { op: "add_line", position: 0, text: "Led the move to Kubernetes." },
    ]);

    expect(result).toEqual({ refused: expect.any(String) });
    expect(await standing(at.person, at.post)).toEqual(before);
  });
});

describe("the caller's transaction (US6)", () => {
  it("leaves the item unchanged when the caller rolls back after the edit", async () => {
    const at = await planted();

    await expect(
      testDb.transaction(async (tx) => {
        const result = await apply(tx, at.person, at.post, [
          { op: "set", field: "title", value: "Never kept" },
          { op: "remove_child", childId: at.child },
        ]);
        expect(result).not.toHaveProperty("refused");
        throw new Error("the entry could not be written");
      }),
    ).rejects.toThrow("the entry could not be written");

    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });
});

describe("what it imports (S4.2)", () => {
  const module = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/lib/profile-edit");

  const imports = async (): Promise<string[]> => {
    const found: string[] = [];
    for await (const file of glob("**/*.ts", { cwd: module })) {
      const source = readFileSync(join(module, file), "utf8");
      for (const [statement] of source.matchAll(/import[^;]*?from\s+"[^"]+";/g)) {
        found.push(statement.replaceAll(/\s+/g, " "));
      }
    }
    return found;
  };

  it("has sources to read at all, so the claims below cannot pass on nothing", async () => {
    expect(await imports()).not.toEqual([]);
  });

  it("imports no use case: no handler, route or assistant", async () => {
    expect(
      (await imports()).filter((statement) => /(handlers|routes|assistants)\//.test(statement)),
    ).toEqual([]);
  });

  it("imports of lib/agent only the AgentTool type, and of lib/conversation only the Transaction", async () => {
    expect((await imports()).filter((statement) => /\/agent"/.test(statement))).toEqual([
      'import type { AgentTool } from "../agent";',
    ]);
    expect((await imports()).filter((statement) => /\/conversation"/.test(statement))).toEqual([
      'import type { Transaction } from "../conversation";',
    ]);
  });
});
