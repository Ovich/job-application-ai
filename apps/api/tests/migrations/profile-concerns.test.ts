import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Seam: `packages/db`'s migrations, applied to PGlite (`SL3`, D14, `ID243`).
 *
 * Behind it: a PGlite of this file's own, and the migration files as generated. The files
 * before `0005` are applied, rules of both kinds and both sources written the way the
 * schema of that day held them, then `0005` applied, and what survives is read. The test
 * applies the files; it does not run drizzle-kit's generator.
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

beforeAll(async () => {
  const renaming = files.findIndex((name) => name.startsWith("0005_"));
  expect(renaming).toBeGreaterThan(0);
  for (const name of files.slice(0, renaming)) await applied(db, name);

  await db.exec(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values ('person', 'Someone', 'someone@example.com', false, now(), now());
    insert into profile_item (id, user_id, kind, title, position)
      values ('item', 'person', 'entry', 'Kubernetes', 0);
    insert into question (id, user_id, item_id, kind, asked, "where", lead, state, position)
      values ('question', 'person', 'item', 'scope', true, 'What you work with', 'Which was it?', 'answered', 0);
    insert into question_option (id, question_id, position, label, hint, rule)
      values ('option-1', 'question', 0, 'Ran the cluster', 'nodes', 'Kubernetes: cluster administration'),
             ('option-2', 'question', 1, 'Something else', 'say it', null);
    insert into rule (id, user_id, item_id, kind, text, source, question_id, superseded_by)
      values ('newest', 'person', 'item', 'constraint', 'Kubernetes: never the cluster', 'own words', null, null),
             ('oldest', 'person', 'item', 'scope', 'Kubernetes: cluster administration', 'answer', 'question', 'newest');
  `);

  for (const name of files.slice(renaming)) await applied(db, name);
});

describe("rules renamed profile concerns, by migration 0005 (D14)", () => {
  it("keeps every rule row of both kinds and both sources as a profile_concern row", async () => {
    const { rows } = await db.query(
      "select id, kind::text as kind, source::text as source, text, question_id from profile_concern order by id",
    );

    expect(rows).toEqual([
      {
        id: "newest",
        kind: "constraint",
        source: "own words",
        text: "Kubernetes: never the cluster",
        question_id: null,
      },
      {
        id: "oldest",
        kind: "scope",
        source: "answer",
        text: "Kubernetes: cluster administration",
        question_id: "question",
      },
    ]);
  });

  it("keeps a superseded chain's superseded_by links", async () => {
    const { rows } = await db.query("select id, superseded_by from profile_concern order by id");

    expect(rows).toEqual([
      { id: "newest", superseded_by: null },
      { id: "oldest", superseded_by: "newest" },
    ]);
  });

  it("carries question_option.rule's values in question_option.concern", async () => {
    const { rows } = await db.query("select id, concern from question_option order by id");

    expect(rows).toEqual([
      { id: "option-1", concern: "Kubernetes: cluster administration" },
      { id: "option-2", concern: null },
    ]);
  });
});
