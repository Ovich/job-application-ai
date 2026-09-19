import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  itemEducation,
  itemExperience,
  itemLine,
  profileConcern,
  profileItem,
  user,
} from "@app/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  apply,
  type Operation,
  profileReadTool,
  type ReadInput,
} from "../../../src/lib/profile-edit";
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

/** One read, in a transaction of its own, as the step would run it. */
const readThrough = (person: string, input: ReadInput) =>
  testDb.transaction((tx) => profileReadTool.run(tx, person, input));

/** The post's concerns: one superseded by the other, so only the second is kept. */
const withConcerns = async (at: Planted) => {
  const first = randomUUID();
  const second = randomUUID();
  await testDb.insert(profileConcern).values({
    id: first,
    userId: at.person,
    itemId: at.post,
    kind: "scope",
    text: "Kubernetes: running the cluster",
    source: "answer",
    createdAt: new Date("2026-09-01T09:00:00.000Z"),
  });
  await testDb.insert(profileConcern).values({
    id: second,
    userId: at.person,
    itemId: at.post,
    kind: "scope",
    text: "Kubernetes: shipping to a cluster run by others",
    source: "own words",
    createdAt: new Date("2026-09-02T09:00:00.000Z"),
  });
  await testDb
    .update(profileConcern)
    .set({ supersededBy: second })
    .where(eq(profileConcern.id, first));
};

/** The planted items in the profile's order: by position, then by id. */
const inOrder = (at: Planted): string[] =>
  [
    { id: at.post, position: 0 },
    { id: at.child, position: 0 },
    { id: at.diploma, position: 1 },
  ]
    .sort((one, other) =>
      one.position === other.position
        ? one.id < other.id
          ? -1
          : 1
        : one.position - other.position,
    )
    .map((each) => each.id);

/**
 * `read_profile` (`ID301`, D33): what the agent knows of the profile, read at its run on
 * the test database. The whole profile, one kind, or one item, each item in the shape
 * `apply` answers it with the concerns kept on it; a refusal in words the model can act
 * on; nothing written.
 */
describe("read_profile (ID301, D33)", () => {
  it("reads the whole profile with no argument, every item in the edit's shape and the profile's order", async () => {
    const at = await planted();

    const read = await readThrough(at.person, {});

    expect(read).toEqual({
      read: {
        items: inOrder(at).map((id) => expect.objectContaining({ id })),
      },
    });
    if (!("read" in read)) throw new Error("the read was refused");
    expect(read.read.items.find((item) => item.id === at.post)).toEqual({
      ...thePost(at),
      concerns: [],
    });
  });

  it("carries the concerns kept on an item, and not the ones superseded", async () => {
    const at = await planted();
    await withConcerns(at);

    const read = await readThrough(at.person, { itemId: at.post });

    expect(read).toEqual({
      read: {
        itemId: at.post,
        items: [
          {
            ...thePost(at),
            concerns: [
              {
                kind: "scope",
                text: "Kubernetes: shipping to a cluster run by others",
                source: "own words",
              },
            ],
          },
        ],
      },
    });
  });

  it("reads one kind: its items alone, and says which kind it read", async () => {
    const at = await planted();

    const read = await readThrough(at.person, { kind: "education" });

    expect(read).toEqual({
      read: { kind: "education", items: [expect.objectContaining({ id: at.diploma })] },
    });
    if (!("read" in read)) throw new Error("the read was refused");
    expect(read.read.items[0]).toEqual({
      id: at.diploma,
      kind: "education",
      title: "Bachelor in computer science",
      subtitle: null,
      startText: null,
      endText: null,
      block: { institution: "HEIG-VD", location: null, credential: null, note: null },
      lines: [{ id: at.diplomaLine, text: "Thesis on scheduling." }],
      children: [],
      concerns: [],
    });
  });

  it("answers the same bytes for two reads of an unchanged profile", async () => {
    const at = await planted();
    await withConcerns(at);

    const once = JSON.stringify(await readThrough(at.person, {}));
    const again = JSON.stringify(await readThrough(at.person, {}));

    expect(again).toBe(once);
    expect(once).toContain(at.diplomaLine);
  });

  it("refuses a kind and an itemId together, saying how to ask instead", async () => {
    const at = await planted();

    const read = await readThrough(at.person, { kind: "experience", itemId: at.post });

    expect(read).toEqual({ refused: expect.stringMatching(/not both/) });
  });

  it("refuses an item that is not the person's, naming it, and reads nothing of it", async () => {
    const at = await planted();
    const other = await planted();

    const read = await readThrough(at.person, { itemId: other.post });

    expect(read).toEqual({ refused: expect.stringContaining(other.post) });
    expect(JSON.stringify(read)).not.toContain("Platform engineer");
    expect(read).toEqual({ refused: expect.stringMatching(/read the whole profile/) });
  });

  it("refuses a kind the profile has none of, naming the kind", async () => {
    const at = await planted();

    const read = await readThrough(at.person, { kind: "publication" });

    expect(read).toEqual({ refused: expect.stringContaining("publication") });
  });

  it("refuses a kind the tool does not know, at its input", () => {
    expect(profileReadTool.input.safeParse({ kind: "hobby" }).success).toBe(false);
    expect(profileReadTool.input.safeParse({}).success).toBe(true);
  });

  it("writes nothing: the profile reads the same before and after", async () => {
    const at = await planted();
    await withConcerns(at);
    const before = await readThrough(at.person, {});

    await readThrough(at.person, { itemId: at.post });
    await readThrough(at.person, { kind: "experience" });
    await readThrough(at.person, { kind: "experience", itemId: at.post });

    expect(await readThrough(at.person, {})).toEqual(before);
    expect(await standing(at.person, at.post)).toEqual(thePost(at));
  });

  it("says what it is doing while it runs: the profile, a kind, or an item", () => {
    expect(profileReadTool.summarise({})).toBe("Reading your profile");
    expect(profileReadTool.summarise({ kind: "experience" })).toBe("Reading: Experience");
    expect(profileReadTool.summarise({ itemId: "item-1" })).toBe("Reading an item of your profile");
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
