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
import { testDb } from "./database";
import { documentsFor } from "./documents";

/**
 * The suite's own profile support (ID129, on SL1's and SL2's precedent).
 *
 * It hides the planting: the person's documents, the items, their per-kind rows and their
 * lines. A test then says what a person's profile *is* and asserts what the route answers,
 * rather than spelling seven inserts and losing the claim in them.
 *
 * **Nothing here ties a fact to a document** (`ID334`): the quote behind a fact is not
 * kept any more. The documents are still planted, because a profile is read back beside
 * them and `readOn` is theirs, but no item cites one.
 *
 * It plants rows and reads none: what a test asserts comes back through
 * `GET /api/intake/profile`, because the route that writes a profile is the route that
 * reads it and the seam stays at the route (the plan's *How this project tests*).
 */

/**
 * One item as a test states it. The per-kind block is the one for its kind and nothing
 * else, which is the shape of the tables themselves.
 */
export type Planted = {
  kind: ItemKind;
  title: string;
  subtitle?: string;
  startText?: string;
  endText?: string;
  experience?: {
    organisation: string;
    organisationNote?: string;
    location?: string;
    arrangement?: string;
  };
  project?: { description: string; datesText?: string };
  education?: { institution: string; location?: string; credential?: string; note?: string };
  entry?: { label: string; qualifier?: string };
  lines?: { text: string }[];
  children?: Planted[];
};

const writeItem = async (
  userId: string,
  item: Planted,
  position: number,
  parentId: string | null,
): Promise<string> => {
  const id = randomUUID();
  await testDb.insert(profileItem).values({
    id,
    userId,
    kind: item.kind,
    parentId,
    title: item.title,
    subtitle: item.subtitle ?? null,
    startText: item.startText ?? null,
    endText: item.endText ?? null,
    position,
  });

  if (item.experience !== undefined) {
    await testDb.insert(itemExperience).values({ itemId: id, ...item.experience });
  }
  if (item.project !== undefined) {
    await testDb.insert(itemProject).values({ itemId: id, ...item.project });
  }
  if (item.education !== undefined) {
    await testDb.insert(itemEducation).values({ itemId: id, ...item.education });
  }
  if (item.entry !== undefined) {
    await testDb.insert(itemEntry).values({ itemId: id, ...item.entry });
  }

  for (const [at, line] of (item.lines ?? []).entries()) {
    await testDb
      .insert(itemLine)
      .values({ id: randomUUID(), itemId: id, text: line.text, position: at });
  }

  for (const [at, child] of (item.children ?? []).entries()) {
    await writeItem(userId, child, at, id);
  }

  return id;
};

/**
 * A person with documents and a profile built from them, on the test database.
 *
 * The documents are rows, not bytes: the object behind one is seam B's business.
 */
export const plantProfile = async (
  userId: string,
  plan: { documents: readonly string[]; items: Planted[] },
): Promise<void> => {
  await documentsFor(userId, plan.documents);
  for (const [at, item] of plan.items.entries()) {
    await writeItem(userId, item, at, null);
  }
};
