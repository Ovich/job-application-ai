import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import type { Part } from "./parts";

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
 * what every kind has and one table per kind carries the rest. A row that points at a
 * fact then needs one foreign key, not one per kind, as the questions and the concerns do.
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
 * **A profile says what it says, and not where it came from** (`ID334`). The quote behind
 * each fact was a table here; it is gone, and where a fact came from is the conversation's
 * to answer.
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

/** One bullet of an experience or a project, ordered. */
export const itemLine = pgTable("item_line", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  position: integer("position").notNull(),
});

/** The row shapes of the profile, named once, inferred from the tables above. */
export type ProfileItem = typeof profileItem.$inferSelect;
export type NewProfileItem = typeof profileItem.$inferInsert;
export type ItemLine = typeof itemLine.$inferSelect;
export type NewItemLine = typeof itemLine.$inferInsert;
export type ItemKind = (typeof itemKind.enumValues)[number];

/**
 * What only the person can answer, and what they answered (ID121, ID122).
 *
 * The three kinds are an enum and not a string, and that is the substance of the spec's
 * "Three kinds, and nothing else": a fourth kind cannot be stored, so criterion 1 is
 * held by the column and not only by a test. PostgreSQL refuses a value outside an enum
 * on PGlite in the suite exactly as it does on the deployed cluster.
 *
 * `on delete cascade` from the item is what makes "a question never points at nothing"
 * true in the database rather than in a query: a later correction that removes an item
 * takes its question and its rules with it.
 */
export const questionKind = pgEnum("question_kind", ["scope", "conflict", "provenance"]);

/**
 * `waiting` is a question nobody has opened yet, `answered` one that produced a rule,
 * and `skipped` one the person put off — which is not the same thing as answered and
 * not the same thing as gone. A skipped question is offered again the first time a CV
 * needs it, in the builder (`US7`), so it is kept and never deleted.
 */
export const questionState = pgEnum("question_state", ["waiting", "answered", "skipped"]);

/**
 * One thing to ask about one item.
 *
 * **`asked` is how the cap of five is kept honestly** (`D19`, `ID122`). The cap is
 * applied when the run writes the questions, not when a screen reads them: the first
 * five are written `asked = true` and the rest `asked = false`, against their items,
 * rather than thrown away. A route that wrote eleven and showed five would leave six
 * questions that look asked and are not, and this column is what makes the difference a
 * fact rather than a query's `limit`.
 *
 * **There is no run column.** A reading run keeps nothing of its own between its steps —
 * there is no `read_run` table in this schema and the plan names none (`ID139`, open) —
 * so a question belongs to its item and its person, and outlives any run. Nothing here
 * needs one: the assistant reads what is waiting, not what one run produced.
 *
 * `where` is the sheet's own words for the region the question is about
 * (`What you work with · DevOps and cloud · in 2 documents`), and `lead` is the question
 * itself. Both are the reader's, kept as it wrote them.
 */
export const question = pgTable("question", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  kind: questionKind("kind").notNull(),
  asked: boolean("asked").notNull(),
  where: text("where").notNull(),
  lead: text("lead").notNull(),
  state: questionState("state").notNull(),
  position: integer("position").notNull(),
  answeredAt: timestamp("answered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One answer a question offers: rows, not a JSON column (`F8`), at most four per
 * question.
 *
 * `concern` is what picking this row writes on the item, in the row's own words rather
 * than a sentence built about it. It is null on the last row and only there, because
 * the last row is always the person's own words and carries no concern of its own.
 */
export const questionOption = pgTable("question_option", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => question.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  label: text("label").notNull(),
  hint: text("hint").notNull(),
  concern: text("concern"),
});

/** What a profile concern is about: the person's part in a fact, or what must never be claimed. */
export const profileConcernKind = pgEnum("profile_concern_kind", ["scope", "constraint"]);

/** Where the words came from: a row the person picked, or the words they typed. */
export const profileConcernSource = pgEnum("profile_concern_source", ["answer", "own words"]);

/**
 * What the person's answer settles about an item: a profile concern (`ID121`, D14, once
 * called a rule).
 *
 * **A profile concern is inserted, never updated.** Answering again inserts a row and sets
 * the old row's `superseded_by` to the new one's id, so the history of what the person said
 * survives being changed. An `update` here would pass every test that reads only the
 * current concern and quietly destroy the one thing this table exists to keep. The item's
 * current concern is the single row whose `superseded_by` is null.
 *
 * `question_id` is nullable because a concern may come from no question at all.
 */
export const profileConcern = pgTable("profile_concern", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => profileItem.id, { onDelete: "cascade" }),
  kind: profileConcernKind("kind").notNull(),
  text: text("text").notNull(),
  source: profileConcernSource("source").notNull(),
  questionId: text("question_id").references(() => question.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  supersededBy: text("superseded_by").references((): AnyPgColumn => profileConcern.id),
});

/** The row shapes of the questions and the profile concerns, named once, inferred as the rest are. */
export type Question = typeof question.$inferSelect;
export type NewQuestion = typeof question.$inferInsert;
export type QuestionOption = typeof questionOption.$inferSelect;
export type NewQuestionOption = typeof questionOption.$inferInsert;
export type ProfileConcern = typeof profileConcern.$inferSelect;
export type NewProfileConcern = typeof profileConcern.$inferInsert;
export type QuestionKind = (typeof questionKind.enumValues)[number];
export type QuestionState = (typeof questionState.enumValues)[number];
export type ProfileConcernKind = (typeof profileConcernKind.enumValues)[number];
export type ProfileConcernSource = (typeof profileConcernSource.enumValues)[number];

/**
 * A conversation: one person's history with one assistant, about an optional subject
 * (`ID160`, the spec's *The conversation*). Every assistant's entries live in these two
 * tables, and each assistant reads only its own.
 *
 * The unique constraint is what makes "coming back to the same subject opens the same
 * conversation" the database's answer, and `nulls not distinct` is what makes it hold
 * for an assistant with no subject: without it two `null` subjects are two values, and
 * two opens racing would each write a conversation.
 */
export const conversationAuthor = pgEnum("conversation_author", [
  "person",
  "assistant",
  "tool",
  "system",
]);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assistant: text("assistant").notNull(),
    subject: text("subject"),
    /**
     * The agent's context window (D36, `ID304`), two entry positions: entries before
     * `context_cut` are not sent, tool results before `context_cleared` are sent as a
     * placeholder. Both null until the conversation first reaches the budget's trigger.
     */
    contextCut: integer("context_cut"),
    contextCleared: integer("context_cleared"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("conversation_user_assistant_subject")
      .on(table.userId, table.assistant, table.subject)
      .nullsNotDistinct(),
  ],
);

/**
 * One turn of a conversation: who wrote it, where it sits, and its parts.
 *
 * **`parts` is the schema's one document column** (`ID160`, within foundation `F16`'s
 * boundary, which amends `F8` for it alone): written once, read whole, never filtered
 * or joined on. A part's shape differs by kind and grows by slice, and a table per kind
 * would be a migration per part for rows nothing ever queries into.
 */
export const conversationEntry = pgTable(
  "conversation_entry",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    author: conversationAuthor("author").notNull(),
    parts: jsonb("parts").$type<Part[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique("conversation_entry_position").on(table.conversationId, table.position)],
);

/** The row shapes of a conversation, named once, inferred as the rest are. */
export type ConversationRow = typeof conversation.$inferSelect;
export type ConversationEntryRow = typeof conversationEntry.$inferSelect;
export type ConversationAuthor = (typeof conversationAuthor.enumValues)[number];
