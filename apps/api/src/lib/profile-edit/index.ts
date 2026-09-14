import { randomUUID } from "node:crypto";
import {
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemLine,
  itemProject,
  profileItem,
} from "@app/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AgentTool } from "../agent";

/**
 * The shared profile-edit capability (`ID168`, `ID187`, the spec's *The shared
 * profile-edit capability*): one item, a small validated set of operations on it, and the
 * item before and after.
 *
 * What it hides: the spine and the per-kind block tables, which fields a kind has, and
 * line positions. What it accepts: the caller's transaction; it opens none and commits
 * none, so an edit and the entry that records it are one write (`US6`).
 *
 * **All operations or none.** Every operation is checked against the item as it stands,
 * one after the other on a draft, before a single row is written; a refusal is a value
 * with its reason, never a throw. A database error still throws.
 *
 * **It knows no assistant and no use case.** It is offered to the agent as
 * `profileEditTool`, and the one thing it takes from `lib/agent` is that tool's type.
 */

/** The transaction a tool runs in, as `lib/agent` hands it over. */
type Tx = Parameters<AgentTool["run"]>[0];

export const operation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set"),
      field: z.string().min(1).describe("the field's name, as the item shows it"),
      value: z.string().nullable().describe("the new value, or null to empty the field"),
    })
    .describe("Set one field of the item: its title, subtitle, dates, or a field of its kind."),
  z
    .object({
      op: z.literal("replace_line"),
      lineId: z.string().min(1),
      text: z.string().min(1),
    })
    .describe("Replace the text of one line of the item."),
  z
    .object({
      op: z.literal("add_line"),
      position: z.number().int().nonnegative().describe("0 is first; later lines move down"),
      text: z.string().min(1),
    })
    .describe("Add a line to the item at a position."),
  z
    .object({ op: z.literal("remove_line"), lineId: z.string().min(1) })
    .describe("Remove one line of the item."),
  z
    .object({ op: z.literal("remove_child"), childId: z.string().min(1) })
    .describe("Remove one item that hangs under this item."),
]);

export type Operation = z.infer<typeof operation>;

/** One edit: an item, and what to do to it. */
export const edit = z.object({
  itemId: z.string().min(1),
  operations: z.array(operation).min(1),
});

export type Edit = z.infer<typeof edit>;

/** One item as an edit reads it: the spine, its kind's fields, its lines and its children. */
export type ItemShape = {
  id: string;
  kind: ItemKind;
  title: string;
  subtitle: string | null;
  startText: string | null;
  endText: string | null;
  block: Record<string, string | null> | null;
  lines: { id: string; text: string }[];
  children: { id: string; kind: ItemKind; title: string }[];
};

export type Applied = { before: ItemShape; after: ItemShape } | { refused: string };

/** The spine's fields, and whether an item can be without each. */
const spine = { title: true, subtitle: false, startText: false, endText: false } as const;

/** Each kind's own fields, and whether an item of it can be without each. */
const blockFields: Partial<Record<ItemKind, Record<string, boolean>>> = {
  experience: { organisation: true, organisationNote: false, location: false, arrangement: false },
  project: { description: true, datesText: false },
  education: { institution: true, location: false, credential: false, note: false },
  entry: { label: true, qualifier: false },
};

const blockOf = async (
  tx: Tx,
  kind: ItemKind,
  itemId: string,
): Promise<Record<string, string | null> | null> => {
  switch (kind) {
    case "experience": {
      const [row] = await tx
        .select({
          organisation: itemExperience.organisation,
          organisationNote: itemExperience.organisationNote,
          location: itemExperience.location,
          arrangement: itemExperience.arrangement,
        })
        .from(itemExperience)
        .where(eq(itemExperience.itemId, itemId));
      return row ?? null;
    }
    case "project": {
      const [row] = await tx
        .select({ description: itemProject.description, datesText: itemProject.datesText })
        .from(itemProject)
        .where(eq(itemProject.itemId, itemId));
      return row ?? null;
    }
    case "education": {
      const [row] = await tx
        .select({
          institution: itemEducation.institution,
          location: itemEducation.location,
          credential: itemEducation.credential,
          note: itemEducation.note,
        })
        .from(itemEducation)
        .where(eq(itemEducation.itemId, itemId));
      return row ?? null;
    }
    case "entry": {
      const [row] = await tx
        .select({ label: itemEntry.label, qualifier: itemEntry.qualifier })
        .from(itemEntry)
        .where(eq(itemEntry.itemId, itemId));
      return row ?? null;
    }
    default:
      return null;
  }
};

/** Writes the kind's own fields. Only the fields `blockFields` names ever reach here. */
const writeBlock = async (
  tx: Tx,
  kind: ItemKind,
  itemId: string,
  values: Record<string, string | null>,
): Promise<void> => {
  switch (kind) {
    case "experience":
      await tx
        .update(itemExperience)
        .set(values as Partial<typeof itemExperience.$inferInsert>)
        .where(eq(itemExperience.itemId, itemId));
      return;
    case "project":
      await tx
        .update(itemProject)
        .set(values as Partial<typeof itemProject.$inferInsert>)
        .where(eq(itemProject.itemId, itemId));
      return;
    case "education":
      await tx
        .update(itemEducation)
        .set(values as Partial<typeof itemEducation.$inferInsert>)
        .where(eq(itemEducation.itemId, itemId));
      return;
    case "entry":
      await tx
        .update(itemEntry)
        .set(values as Partial<typeof itemEntry.$inferInsert>)
        .where(eq(itemEntry.itemId, itemId));
      return;
    default:
      return;
  }
};

/** The person's item as it stands, or nothing when the person has no such item. */
const shapeOf = async (tx: Tx, person: string, itemId: string): Promise<ItemShape | undefined> => {
  const [item] = await tx
    .select({
      id: profileItem.id,
      kind: profileItem.kind,
      title: profileItem.title,
      subtitle: profileItem.subtitle,
      startText: profileItem.startText,
      endText: profileItem.endText,
    })
    .from(profileItem)
    .where(and(eq(profileItem.id, itemId), eq(profileItem.userId, person)));
  if (item === undefined) return undefined;

  const lines = await tx
    .select({ id: itemLine.id, text: itemLine.text })
    .from(itemLine)
    .where(eq(itemLine.itemId, itemId))
    .orderBy(asc(itemLine.position), asc(itemLine.id));
  const children = await tx
    .select({ id: profileItem.id, kind: profileItem.kind, title: profileItem.title })
    .from(profileItem)
    .where(and(eq(profileItem.parentId, itemId), eq(profileItem.userId, person)))
    .orderBy(asc(profileItem.position), asc(profileItem.id));

  return { ...item, block: await blockOf(tx, item.kind, itemId), lines, children };
};

/**
 * Every item of the person's profile as it stands, in the shape an edit reads it and in
 * the profile's order (`ID193`): what the agent is shown, so an edit can name each item
 * and each line it changes by its id.
 */
export const itemsOf = async (tx: Tx, person: string): Promise<ItemShape[]> => {
  const ids = await tx
    .select({ id: profileItem.id })
    .from(profileItem)
    .where(eq(profileItem.userId, person))
    .orderBy(asc(profileItem.position), asc(profileItem.id));
  const items: ItemShape[] = [];
  for (const { id } of ids) {
    const item = await shapeOf(tx, person, id);
    if (item !== undefined) items.push(item);
  }
  return items;
};

/** Said when an operation names a line or a child the item no longer has. */
const stale = "no longer exists on this item; the profile may have changed, so reload it";

/** One operation on the draft: the draft it leaves, or why it cannot be done. */
const step = (draft: ItemShape, said: Operation): ItemShape | string => {
  switch (said.op) {
    case "set": {
      const own = blockFields[draft.kind];
      const required =
        said.field in spine
          ? spine[said.field as keyof typeof spine]
          : draft.block !== null && own !== undefined && said.field in own
            ? own[said.field]
            : undefined;
      if (required === undefined) {
        return `An item of kind ${draft.kind} has no field ${said.field}.`;
      }
      if (required && (said.value === null || said.value.trim() === "")) {
        return `The field ${said.field} cannot be emptied.`;
      }
      return said.field in spine
        ? { ...draft, [said.field]: said.value }
        : { ...draft, block: { ...draft.block, [said.field]: said.value } };
    }
    case "replace_line": {
      if (!draft.lines.some((line) => line.id === said.lineId)) {
        return `The line ${said.lineId} ${stale}.`;
      }
      return {
        ...draft,
        lines: draft.lines.map((line) =>
          line.id === said.lineId ? { ...line, text: said.text } : line,
        ),
      };
    }
    case "add_line": {
      if (said.position > draft.lines.length) {
        return `The item has ${draft.lines.length} lines; a line can be added at 0 to ${draft.lines.length}.`;
      }
      const lines = [...draft.lines];
      lines.splice(said.position, 0, { id: randomUUID(), text: said.text });
      return { ...draft, lines };
    }
    case "remove_line": {
      if (!draft.lines.some((line) => line.id === said.lineId)) {
        return `The line ${said.lineId} ${stale}.`;
      }
      return { ...draft, lines: draft.lines.filter((line) => line.id !== said.lineId) };
    }
    case "remove_child": {
      if (!draft.children.some((child) => child.id === said.childId)) {
        return `The item ${said.childId} ${stale}.`;
      }
      return { ...draft, children: draft.children.filter((child) => child.id !== said.childId) };
    }
  }
};

const same = (one: unknown, other: unknown): boolean =>
  JSON.stringify(one) === JSON.stringify(other);

/** Writes what the draft changed of the item, and nothing it did not. */
const write = async (
  tx: Tx,
  person: string,
  before: ItemShape,
  after: ItemShape,
): Promise<void> => {
  const spineOf = (item: ItemShape) => ({
    title: item.title,
    subtitle: item.subtitle,
    startText: item.startText,
    endText: item.endText,
  });
  if (!same(spineOf(before), spineOf(after))) {
    await tx.update(profileItem).set(spineOf(after)).where(eq(profileItem.id, after.id));
  }
  if (after.block !== null && !same(before.block, after.block)) {
    await writeBlock(tx, after.kind, after.id, after.block);
  }

  const kept = new Set(after.lines.map((line) => line.id));
  const removed = before.lines.filter((line) => !kept.has(line.id)).map((line) => line.id);
  if (removed.length > 0) {
    await tx
      .delete(itemLine)
      .where(and(eq(itemLine.itemId, after.id), inArray(itemLine.id, removed)));
  }
  const was = new Map(before.lines.map((line, at) => [line.id, { text: line.text, at }]));
  for (const [at, line] of after.lines.entries()) {
    const earlier = was.get(line.id);
    if (earlier === undefined) {
      await tx
        .insert(itemLine)
        .values({ id: line.id, itemId: after.id, text: line.text, position: at });
    } else if (earlier.text !== line.text || earlier.at !== at) {
      await tx
        .update(itemLine)
        .set({ text: line.text, position: at })
        .where(eq(itemLine.id, line.id));
    }
  }

  const children = new Set(after.children.map((child) => child.id));
  const gone = before.children.filter((child) => !children.has(child.id)).map((child) => child.id);
  if (gone.length > 0) {
    await tx
      .delete(profileItem)
      .where(
        and(
          eq(profileItem.parentId, after.id),
          eq(profileItem.userId, person),
          inArray(profileItem.id, gone),
        ),
      );
  }
};

/**
 * The edit, in the caller's transaction: the item before and after, or the refusal with
 * its reason and nothing written. No operation at all reads the item as it stands.
 */
export const apply = async (
  tx: Tx,
  person: string,
  itemId: string,
  operations: Operation[],
): Promise<Applied> => {
  const before = await shapeOf(tx, person, itemId);
  if (before === undefined) return { refused: `There is no item ${itemId} in this profile.` };

  let draft = before;
  for (const said of operations) {
    const moved = step(draft, said);
    if (typeof moved === "string") return { refused: moved };
    draft = moved;
  }

  await write(tx, person, before, draft);
  const after = await shapeOf(tx, person, itemId);
  if (after === undefined) throw new Error(`the item ${itemId} vanished while it was edited`);
  return { before, after };
};

/** The capability as the agent is offered it (`ID187`): one tool any definition lists. */
export const profileEditTool: AgentTool<Edit, Applied> = {
  name: "edit_profile",
  description:
    "Change one item of the person's profile: set a field, replace, add or remove a line, or remove an item under it. The operations apply all together or not at all; the answer is the item before and after, or why the edit was refused.",
  input: edit,
  run: (tx, person, input) => apply(tx, person, input.itemId, input.operations),
};
