import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDirectoryStorage,
  type ObjectKey,
  type Storage,
  type StoredObject,
} from "../../src/lib/storage";

/**
 * The suite's own storage support.
 *
 * It hides the temporary directory and its cleanup, so no test writes into the
 * repository's own object directory and no test is left cleaning up after one that
 * failed. It leaves no directory and no global state behind.
 *
 * `objectsHeld` answers through the same interface the test wrote with, and that is the
 * discipline the whole seam rests on: a test that listed the directory would break on
 * the day S3 is the implementation and would prove nothing about the interface either
 * way (the slice's "watch out"). What it reports is what `put` and `delete` were asked
 * to do, observed on the way through.
 */

/** What `localStorageIn` hands back: a storage, and the directory removed on disposal. */
export type StorageInPlace = Storage & { dispose: () => void };

/**
 * Which keys a storage made by this support is holding. A `WeakMap` rather than a field
 * on the storage, so the shape a test passes around stays exactly `Storage` and nothing
 * in a test can reach the record except through this function.
 */
const held = new WeakMap<Storage, Set<string>>();

/**
 * A storage that remembers what went through it. The recording is in front of the
 * implementation, never inside it: what is remembered is a call a caller made, and a
 * failed `put` records nothing because it never returns.
 */
const recording = <T extends Storage>(storage: Storage, rest: Omit<T, keyof Storage>): T => {
  const keys = new Set<string>();
  const recorded = {
    ...rest,
    put: async (key: ObjectKey, object: StoredObject) => {
      await storage.put(key, object);
      keys.add(key);
    },
    get: (key: ObjectKey) => storage.get(key),
    delete: async (key: ObjectKey) => {
      await storage.delete(key);
      keys.delete(key);
    },
  } as T;
  held.set(recorded, keys);
  return recorded;
};

/**
 * A directory storage on a temporary directory, disposed of by hand.
 *
 * A `Disposable` would be the natural shape and is not available: this repository's
 * TypeScript library is `ES2023`, which has no `Symbol.dispose`. `dispose()` in an
 * `afterEach` is the same discipline written by hand, as `tests/support/ai.ts` already
 * writes it.
 */
export const localStorageIn = (directory?: string): StorageInPlace => {
  const root = directory ?? mkdtempSync(join(tmpdir(), "jobapp-objects-"));
  return recording<StorageInPlace>(createDirectoryStorage({ directory: root }), {
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  });
};

/** A storage of any implementation, watched the same way, for a test that stands one in. */
export const watching = (storage: Storage): Storage => recording<Storage>(storage, {});

/** Every key a storage made here is holding, sorted, through the interface alone. */
export const objectsHeld = (storage: Storage): ObjectKey[] =>
  [...(held.get(storage) ?? [])].sort() as ObjectKey[];

/**
 * The bytes of a document, made up rather than read from a file, for the cases that
 * care about size or sameness rather than about content. `size` bytes of one value.
 */
export const bytesOf = (size: number, fill = 7): Uint8Array => new Uint8Array(size).fill(fill);
