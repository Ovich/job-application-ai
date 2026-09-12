import type { ObjectKey } from "./key";

/**
 * What a storage holds and what it answers. In its own file because both
 * implementations use it and neither should have to import the other to say what an
 * object is.
 */

/** What was uploaded: the bytes, and what the browser said they were. */
export type StoredObject = { bytes: Uint8Array; mediaType: string };

/**
 * The one interface over uploaded bytes (ID115).
 *
 * `get` answers `null` for an absent key rather than throwing, because a caller that
 * holds a row whose object is gone must be able to say so — and the order this product
 * writes in makes that a real state: the row comes first, the key is composed from its
 * id, and only then is the object put, so a failed put leaves a row whose object is
 * absent. `put` and `delete` throw, with the key named.
 */
export type Storage = {
  put: (key: ObjectKey, object: StoredObject) => Promise<void>;
  get: (key: ObjectKey) => Promise<StoredObject | null>;
  delete: (key: ObjectKey) => Promise<void>;
};
