import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
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
