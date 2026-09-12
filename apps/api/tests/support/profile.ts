import { randomUUID } from "node:crypto";
import {
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemLine,
  itemProject,
  profileItem,
  provenance,
} from "@app/db";
import { testDb } from "./database";
import { documentsFor } from "./documents";

/**
 * The suite's own profile support (ID129, on SL1's and SL2's precedent).
 *
 * It hides the planting: the person's documents, the items, their per-kind rows, their
 * lines and the provenance that ties each fact to the document that stated it. A test
 * then says what a person's profile *is* and asserts what the route answers, rather
 * than spelling seven inserts and losing the claim in them.
 *
 * It plants rows and reads none: what a test asserts comes back through
 * `GET /api/intake/profile`, because the route that writes a profile is the route that
 * reads it and the seam stays at the route (the plan's *How this project tests*).
 */

/** What a document said about one fact, verbatim, and which document said it. */
export type Said = { document: string; said: string };

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
  lines?: { text: string; from?: Said[] }[];
  children?: Planted[];
  from?: Said[];
};

/** Which document row a `said` names, by the filename a test wrote. */
type Documents = Map<string, string>;

const writeItem = async (
  userId: string,
  documents: Documents,
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
    const lineId = randomUUID();
    await testDb.insert(itemLine).values({ id: lineId, itemId: id, text: line.text, position: at });
    for (const source of line.from ?? []) {
      await testDb.insert(provenance).values({
        id: randomUUID(),
        documentId: documentOf(documents, source.document),
        lineId,
        said: source.said,
      });
    }
  }

  for (const source of item.from ?? []) {
    await testDb.insert(provenance).values({
      id: randomUUID(),
      documentId: documentOf(documents, source.document),
      itemId: id,
      said: source.said,
    });
  }

  for (const [at, child] of (item.children ?? []).entries()) {
    await writeItem(userId, documents, child, at, id);
  }

  return id;
};

const documentOf = (documents: Documents, filename: string): string => {
  const id = documents.get(filename);
  if (id === undefined) {
    throw new Error(
      `The plan quotes ${filename}, which is not one of the documents it planted. Name it in \`documents\`.`,
    );
  }
  return id;
};

/**
 * A person with documents and a profile built from them, on the test database.
 *
 * The documents are rows, not bytes: what a profile case is about is which document a
 * fact came from, and the object behind it is seam B's business.
 */
export const plantProfile = async (
  userId: string,
  plan: { documents: readonly string[]; items: Planted[] },
): Promise<void> => {
  const rows = await documentsFor(userId, plan.documents);
  const documents: Documents = new Map(rows.map((row) => [row.filename, row.id]));
  for (const [at, item] of plan.items.entries()) {
    await writeItem(userId, documents, item, at, null);
  }
};
