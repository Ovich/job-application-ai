import { type ObjectKey, readKey } from "./key";
import type { Storage, StoredObject } from "./types";

/**
 * The implementation the deployed function runs.
 *
 * The client is constructed inside this module, from the values it was configured
 * with, and it is never a caller's concern: a handler writes `storage.put(key, object)`
 * and learns nothing about a bucket, a region or a credential.
 *
 * Two things are deliberate here. The client is loaded by a dynamic import the first
 * time an operation runs, not by a top-level one, so a developer running the directory
 * implementation never pays for a client they will not construct and `app.ts` stays
 * free of anything AWS (the slice's "what is already known"). And the three operations
 * are one function each, behind `S3Calls`, which is the boundary the suite stands in at
 * — one function per operation, no client, no network, and the adapter's own decisions
 * (what a missing key means, what travels with the bytes) still under test.
 */

/** One request to the bucket, as this module makes them. */
export type S3Call = { bucket: string; key: ObjectKey };

/** S3, reduced to what this module asks of it. The suite stands in here. */
export type S3Calls = {
  put: (call: S3Call & { object: StoredObject }) => Promise<void>;
  get: (call: S3Call) => Promise<StoredObject | null>;
  delete: (call: S3Call) => Promise<void>;
};

export type S3StorageConfig = {
  bucket: string;
  /** The suite's stand-in. Absent, the real client is loaded when it is first needed. */
  calls?: S3Calls;
};

/** The status a bucket answers for a key it does not hold. */
const notFound = new Set(["NoSuchKey", "NotFound"]);

/**
 * The real client, loaded once and only when something is actually stored. The region
 * and the credentials are the runtime's own: a Lambda has both in its environment, read
 * by the SDK rather than by this product, which is why `env.ts` carries neither.
 */
const realCalls = (() => {
  let loading: Promise<S3Calls> | undefined;

  const load = async (): Promise<S3Calls> => {
    const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } =
      await import("@aws-sdk/client-s3");
    const client = new S3Client({});
    return {
      put: async ({ bucket, key, object }) => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: object.bytes,
            ContentType: object.mediaType,
          }),
        );
      },
      get: async ({ bucket, key }) => {
        try {
          const answer = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const bytes = await answer.Body?.transformToByteArray();
          if (bytes === undefined) return null;
          return { bytes, mediaType: answer.ContentType ?? "application/octet-stream" };
        } catch (cause) {
          const name = (cause as { name?: string }).name ?? "";
          if (notFound.has(name)) return null;
          throw cause;
        }
      },
      delete: async ({ bucket, key }) => {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      },
    };
  };

  return (): Promise<S3Calls> => (loading ??= load());
})();

export const createS3Storage = (config: S3StorageConfig): Storage => {
  const calls = async (): Promise<S3Calls> => config.calls ?? (await realCalls());
  const bucket = config.bucket;

  return {
    put: async (key, object) => {
      readKey(key);
      try {
        await (await calls()).put({ bucket, key, object });
      } catch (cause) {
        throw new Error(`The object ${key} could not be stored`, { cause });
      }
    },

    get: async (key) => {
      readKey(key);
      return (await calls()).get({ bucket, key });
    },

    delete: async (key) => {
      readKey(key);
      try {
        await (await calls()).delete({ bucket, key });
      } catch (cause) {
        throw new Error(`The object ${key} could not be deleted`, { cause });
      }
    },
  };
};
