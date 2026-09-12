/**
 * The key an object lives under, and the only way to make one.
 *
 * **A key is always `u/<user>/<document>`.** Every implementation is given the same
 * key, and the prefix is what keeps one person's documents out of another's: the
 * deployed function's role grants put, get and delete on `u/*` of one bucket and
 * nothing else (ID116), so a key composed any other way cannot reach an object at all.
 *
 * `ObjectKey` says that shape in the type system, and `keyFor` is the only thing that
 * produces one, so no caller can compose a key that reaches another user's prefix. The
 * type is not the whole of it, though: a value asserted past it is still a string at
 * run time, so every implementation reads its key through `readKey` before it does
 * anything with it.
 */

/** Where an object lives: this user, this document, and nothing else in the path. */
export type ObjectKey = `u/${string}/${string}`;

/**
 * What an id may be made of. Better Auth's ids are alphanumeric, and a document's is
 * one of the same; the dot, the dash and the underscore are allowed because they are
 * harmless in a path and a later id scheme may use them. What is not allowed is the
 * slash and the dot-segment, which are the two ways a path climbs out of its prefix.
 */
const idPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

const isId = (value: string): boolean => idPattern.test(value) && value !== "." && value !== "..";

/** The key for one user's one document. The only way to make an `ObjectKey`. */
export const keyFor = (userId: string, documentId: string): ObjectKey => {
  if (!isId(userId) || !isId(documentId)) {
    throw new Error(
      `A storage key is u/<user>/<document> and neither part may hold a path: ${userId}/${documentId}`,
    );
  }
  return `u/${userId}/${documentId}`;
};

/**
 * The key a caller handed over, read back as its two parts, or a throw naming it.
 *
 * Every operation goes through here, because the type alone is a compile-time promise
 * and the caller nearest a bug is the one that asserted past it.
 */
export const readKey = (key: ObjectKey): { userId: string; documentId: string } => {
  const parts = String(key).split("/");
  const [prefix, userId, documentId] = parts;
  if (parts.length !== 3 || prefix !== "u" || userId === undefined || documentId === undefined) {
    throw new Error(`Not a storage key, which is u/<user>/<document>: ${String(key)}`);
  }
  if (!isId(userId) || !isId(documentId)) {
    throw new Error(`Not a storage key, which is u/<user>/<document>: ${String(key)}`);
  }
  return { userId, documentId };
};
