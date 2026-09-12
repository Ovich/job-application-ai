import { env } from "../../env";
import { createDirectoryStorage } from "./directory";
import { createS3Storage } from "./s3";
import type { Storage } from "./types";

/**
 * The module that owns uploaded bytes (ID115). This file is its whole public face: a
 * handler writes `from "../lib/storage"` and learns nothing about which implementation
 * is in use, the directory, the bucket name, the S3 client's construction, or the
 * difference between a missing object and an empty one.
 *
 * Two implementations, chosen by configuration, and the second is not a port for tests:
 * the directory is what a developer runs and S3 is what the deployed environment runs.
 * So both are production, both are exercised against the same cases, and a case that
 * passes against one and not the other is a real defect rather than a test artefact.
 *
 * The configuration arrives as values, from `env.ts`, which is the one reader of the
 * process environment. `createDirectoryStorage` and `createS3Storage` are exported
 * beside the configured instance for the suite, which builds its own on a temporary
 * directory and its own with the client stood in.
 *
 * **The database holds the key and never the bytes.** Nothing here writes a row, and
 * nothing above here stores a byte anywhere else.
 */

/** The implementation configuration chose, built once, at module load. */
export const storage: Storage =
  env.STORAGE_IMPLEMENTATION === "s3"
    ? createS3Storage({ bucket: env.STORAGE_BUCKET })
    : createDirectoryStorage({ directory: env.STORAGE_DIRECTORY });

export { createDirectoryStorage, type DirectoryStorageConfig } from "./directory";
export { keyFor, type ObjectKey } from "./key";
export { createS3Storage, type S3Call, type S3Calls, type S3StorageConfig } from "./s3";
export type { Storage, StoredObject } from "./types";
