import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type ObjectKey, readKey } from "./key";
import type { Storage, StoredObject } from "./types";

/**
 * The implementation a developer runs: a directory under the repository.
 *
 * It is not a fake. `pnpm dev` uploads real files into it and reads them back, so the
 * screen a person clicks through on a laptop exercises the same interface the deployed
 * function exercises against S3 (ID115). What is different is the cost of running it:
 * no bucket, no credentials, no account.
 *
 * The media type travels beside the bytes, in a second file, because a filesystem has
 * nowhere else to put it: S3 carries it as the object's own `Content-Type`, and the
 * interface promises it comes back either way. The alternative — deriving it from the
 * extension on the way out — would make the two implementations disagree about a file
 * whose name says one thing and whose bytes say another, which is exactly the case an
 * intake meets.
 */

/** The suffix of the file that holds what the bytes were said to be. */
const mediaTypeSuffix = ".media-type";

export type DirectoryStorageConfig = {
  /** Where objects go. Relative paths resolve against the process's directory. */
  directory: string;
};

export const createDirectoryStorage = (config: DirectoryStorageConfig): Storage => {
  const root = resolve(config.directory);

  /** The file an object's bytes live in. Reads the key first, so nothing climbs out. */
  const pathOf = (key: ObjectKey): string => {
    const { userId, documentId } = readKey(key);
    return join(root, "u", userId, documentId);
  };

  return {
    put: async (key, object) => {
      const path = pathOf(key);
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, object.bytes);
        await writeFile(`${path}${mediaTypeSuffix}`, object.mediaType, "utf8");
      } catch (cause) {
        throw new Error(`The object ${key} could not be stored`, { cause });
      }
    },

    get: async (key) => {
      const path = pathOf(key);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        // Absent, not empty: the one distinction this interface promises to keep.
        return null;
      }
      const mediaType = await readFile(`${path}${mediaTypeSuffix}`, "utf8").catch(
        () => "application/octet-stream",
      );
      return {
        // Copied out of the Buffer's own pool, so what a caller holds is these bytes
        // and this length, never a view onto whatever Node reused the allocation for.
        bytes: new Uint8Array(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
        mediaType,
      } satisfies StoredObject;
    },

    delete: async (key) => {
      const path = pathOf(key);
      try {
        await rm(path, { force: true });
        await rm(`${path}${mediaTypeSuffix}`, { force: true });
      } catch (cause) {
        throw new Error(`The object ${key} could not be deleted`, { cause });
      }
    },
  };
};
