import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Seam: `packages/db`'s migrations, applied to PGlite (`SL3`, `D14`, `ID243`), as
 * `profile-concerns.test.ts` crosses it.
 *
 * Behind it: a PGlite of this file's own and the migration files as generated. `provenance`
 * is written the way the schema held it before `0008`, then `0008` is applied, and what is
 * asked is whether the table is there. The test applies the files; it does not run
 * drizzle-kit's generator.
 *
 * This is the half of `ID334` no route can show: `GET /profile` proves the product stopped
 * reading the table, and only the migration proves a deployed cluster stops holding it.
 */

const folder = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));
const files = readdirSync(folder)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const applied = async (db: PGlite, name: string) => {
  for (const statement of readFileSync(`${folder}/${name}`, "utf8").split(
    "--> statement-breakpoint",
  )) {
    if (statement.trim() !== "") await db.exec(statement);
  }
};

const db = new PGlite();

/** Whether the database holds a table by that name, asked of PostgreSQL's own catalogue. */
const holdsTable = async (name: string): Promise<boolean> => {
  const { rows } = await db.query<{ count: string }>(
    "select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_name = $1",
    [name],
  );
  return rows[0]?.count !== "0";
};

let heldBefore = false;

beforeAll(async () => {
  const dropping = files.findIndex((name) => name.startsWith("0008_"));
  expect(dropping).toBeGreaterThan(0);
  for (const name of files.slice(0, dropping)) await applied(db, name);

  // A person, a document and a fact cited from it, as the schema held them until `0008`:
  // the drop below is made over a table with rows in it and not over an empty one.
  await db.exec(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values ('person', 'Someone', 'someone@example.com', false, now(), now());
    insert into document (id, user_id, filename, media_type, source, status)
      values ('paper', 'person', 'cv.pdf', 'application/pdf', 'upload', 'read');
    insert into profile_item (id, user_id, kind, title, position)
      values ('item', 'person', 'entry', 'Kubernetes', 0);
    insert into provenance (id, document_id, item_id, said)
      values ('quote', 'paper', 'item', 'Kubernetes, in production.');
  `);
  heldBefore = await holdsTable("provenance");

  for (const name of files.slice(dropping)) await applied(db, name);
});

describe("provenance is dropped, by migration 0008 (ID334)", () => {
  it("leaves no provenance table behind", async () => {
    // It was really there, with a row in it, before `0008` ran.
    expect(heldBefore).toBe(true);

    expect(await holdsTable("provenance")).toBe(false);
  });

  it("keeps the documents and the profile the quotes hung between", async () => {
    const documents = await db.query<{ id: string }>("select id from document");
    const items = await db.query<{ id: string }>("select id from profile_item");

    expect(documents.rows.map((row) => row.id)).toEqual(["paper"]);
    expect(items.rows.map((row) => row.id)).toEqual(["item"]);
  });
});
