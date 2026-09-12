import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { check, integer, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/**
 * The database schema: every table the product has, and the single source of truth for
 * every data shape above it. Types flow from here through `@app/db` into the API's
 * `AppType` and from there into the web app, so a shape written here is never written
 * again anywhere.
 *
 * `document` is the product's first table of its own (ID117). `auth-schema.ts` beside
 * it stays generated and untouched, and this table references its `user` with
 * `on delete cascade`, so deleting an account takes the rows with it and the hook that
 * arrives in SL5 has only the storage objects left to erase (ID126).
 */

/**
 * What a person handed over: one uploaded file, or one typed source with no file at all.
 *
 * Relational, no JSON column (F8). The kind and the language the reader detected are
 * columns, because they are asked about — a row is listed with its kind — and a column
 * that is asked about is a column.
 *
 * **The bytes are not here.** The database holds the storage key and `lib/storage` holds
 * the object (ID115); the key is `u/<user>/<document>`, composed from this row's own id,
 * which is why the row is always written before the object is put.
 *
 * `source` is `file` or `linkedin_address`, and the typed address is the one source that
 * has no bytes, no key and no hash — which is why those three are nullable and the
 * uniqueness below can be stated at all (D3, US2).
 *
 * `detected_kind` holds `cv`, `diploma`, `work_certificate`, `linkedin_export`,
 * `photo_of_cv` or `unknown`. The last two arrive with no canned case behind them,
 * because the person's own document set holds neither (D20): they are values a column
 * accepts, not code paths, and nothing in this slot branches on a kind.
 *
 * The unique constraint is on `(user_id, content_hash)` and not on the hash alone: two
 * people may hold the same public diploma, and refusing the second one would be refusing
 * a document to a person who has never uploaded it. It is what makes the duplicate
 * refusal the database's own answer rather than a read-then-write a second request can
 * slip between.
 */
export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    source: text("source").notNull(),
    address: text("address"),
    detectedKind: text("detected_kind"),
    detectedLanguage: text("detected_language"),
    storageKey: text("storage_key"),
    contentHash: text("content_hash"),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique("document_user_content_hash").on(table.userId, table.contentHash)],
);

/**
 * The row shapes, named once. Every caller reads them from here rather than declaring
 * the columns again: Drizzle infers them from the table above, so a column added or
 * renamed there moves every type above it and nothing drifts (spec *Data*).
 */
export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;

/**
 * What a profile is made of (ID120). Relational, and there is no JSON column anywhere
 * below this line (F8): a profile item's shape differs by kind, so the spine carries
 * what every kind has and one table per kind carries the rest. Provenance then needs
 * one foreign key, not one per kind, and so will the rules and the questions of SL4.
 *
 * Three choices in the shape are the substance of it, and each one is a claim the
 * product makes about itself:
 *
 * **Dates are text, as the document wrote them.** "Feb — Dec 2024", "2008" and "since
 * 2022" are three different statements, and parsing them into a range is inferring
 * something no document said. Nothing is ordered by a date either; `position` is what
 * orders a profile (D16).
 *
 * **`item_entry` has no duration column at all.** A CV states a post's dates, never how
 * long a tool was used, so "Kubernetes, 2 years" is arithmetic and not a fact. Leaving
 * the column out makes that a thing the database cannot express rather than a thing the
 * screen must remember not to draw (D16).
 *
 * **A fact points at one thing**, an item or a line, and the check constraint below is
 * what says so. `num_nonnulls` is PostgreSQL's own, so it is enforced on PGlite in the
 * suite exactly as it is on the deployed cluster (ID49).
 */
export const itemKind = pgEnum("item_kind", [
  "summary",
  "identity",
  "experience",
  "project",
  "education",
  "publication",
  "language",
  "group",
  "entry",
]);

/**
 * The spine: what every kind of profile item has.
 *
 * `parent_id` is the whole of the nesting. A project hangs under its experience through
 * it; a personal project is a `project` with no parent; a group's entries are `entry`
 * items parented to the group, and an entry may not itself have children, which is what
 * makes a group flat by construction (D17).
 */
export const profileItem = pgTable("profile_item", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kind: itemKind("kind").notNull(),
  parentId: text("parent_id").references((): AnyPgColumn => profileItem.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  startText: text("start_text"),
  endText: text("end_text"),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A post: who it was for, where, and how it was worked. */
export const itemExperience = pgTable("item_experience", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  organisation: text("organisation").notNull(),
  organisationNote: text("organisation_note"),
  location: text("location"),
  arrangement: text("arrangement"),
});

/** A project, under a post or standing alone. `dates_text` is the document's own words. */
export const itemProject = pgTable("item_project", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  datesText: text("dates_text"),
});

/** A diploma or a course: where it was taken and what it is called. */
export const itemEducation = pgTable("item_education", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  institution: text("institution").notNull(),
  location: text("location"),
  credential: text("credential"),
  note: text("note"),
});

/** One chip: a thing the person works with, named in a document. No duration column. */
export const itemEntry = pgTable("item_entry", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  qualifier: text("qualifier"),
});

/** One bullet of an experience or a project, ordered, with provenance of its own. */
export const itemLine = pgTable("item_line", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  position: integer("position").notNull(),
});

/**
 * One fact, one document, and what that document said about it, verbatim.
 *
 * Two documents that state the same post differently give the one item two rows here,
 * each carrying its own document's wording in its own language. The merge picks no
 * winner and writes no third wording: what a person is shown is where a fact came from,
 * which is the product's one claim.
 */
export const provenance = pgTable(
  "provenance",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => profileItem.id, { onDelete: "cascade" }),
    lineId: text("line_id").references(() => itemLine.id, { onDelete: "cascade" }),
    said: text("said").notNull(),
  },
  (table) => [check("one_fact", sql`num_nonnulls(${table.itemId}, ${table.lineId}) = 1`)],
);

/** The row shapes of the profile, named once, inferred from the tables above. */
export type ProfileItem = typeof profileItem.$inferSelect;
export type NewProfileItem = typeof profileItem.$inferInsert;
export type ItemLine = typeof itemLine.$inferSelect;
export type NewItemLine = typeof itemLine.$inferInsert;
export type Provenance = typeof provenance.$inferSelect;
export type NewProvenance = typeof provenance.$inferInsert;
export type ItemKind = (typeof itemKind.enumValues)[number];
