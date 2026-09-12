import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDirectoryStorage,
  createS3Storage,
  keyFor,
  type ObjectKey,
  type S3Calls,
  type Storage,
  type StoredObject,
} from "../../../src/lib/storage";

/**
 * Seam A: `lib/storage`, its `put`, `get` and `delete` (criterion 1, criterion 3).
 *
 * The module owns uploaded bytes and hides which implementation is in use. There are
 * two, and the second is not a port for tests: the directory is what a developer runs
 * and S3 is what the deployed environment runs (ID115). So the same case table is run
 * against both, and a case that passes against one and not the other is the bug this
 * file exists to catch.
 *
 * Nothing here looks in the directory and nothing here reaches AWS. The local
 * implementation writes a temporary directory; the S3 implementation is given its three
 * operations stood in for at its own boundary, one function each, which is where a
 * client would otherwise be constructed. What is asserted either way is the interface:
 * the key the interface was given is the key the interface reads back.
 */

const removals: (() => void)[] = [];

afterEach(() => {
  for (const remove of removals.splice(0)) remove();
});

/** A temporary directory that this file removes, whatever the case did. */
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "jobapp-storage-seam-"));
  removals.push(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
};

/**
 * S3's three operations, standing in for the client. A `Map` of what was put, which is
 * all the interface can observe of a bucket: the adapter under test is the thing that
 * decides what a missing key means and what travels with the bytes.
 */
const standInFor = (): { calls: S3Calls; bucketHolds: () => string[] } => {
  const objects = new Map<string, StoredObject>();
  return {
    calls: {
      put: async ({ bucket, key, object }) => {
        objects.set(`${bucket}/${key}`, object);
      },
      get: async ({ bucket, key }) => objects.get(`${bucket}/${key}`) ?? null,
      delete: async ({ bucket, key }) => {
        objects.delete(`${bucket}/${key}`);
      },
    },
    bucketHolds: () => [...objects.keys()].sort(),
  };
};

/** The two implementations, each built fresh, under the names the cases read by. */
const implementations: [string, () => Storage][] = [
  ["the directory a developer runs", () => createDirectoryStorage({ directory: temporaryDirectory() })],
  ["S3, the one the cloud runs", () => createS3Storage({ bucket: "jobapp-dev-documents", calls: standInFor().calls })],
];

const key = keyFor("user-one", "document-one");
const pdf: StoredObject = { bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), mediaType: "application/pdf" };

describe.each(implementations)("%s", (_name, build) => {
  it("hands back the same bytes and the same media type it was given", async () => {
    const storage = build();

    await storage.put(key, pdf);

    expect(await storage.get(key)).toEqual(pdf);
  });

  it("reports an absent key as absent, rather than as an empty object", async () => {
    const storage = build();

    expect(await storage.get(keyFor("user-one", "never-written"))).toBeNull();
  });

  it("reports a deleted key as absent, so a caller can say the object is gone", async () => {
    const storage = build();
    await storage.put(key, pdf);

    await storage.delete(key);

    expect(await storage.get(key)).toBeNull();
  });

  it("keeps one user's object out of another's, because the prefix is part of the key", async () => {
    const storage = build();
    const mine = keyFor("user-one", "document-one");
    const theirs = keyFor("user-two", "document-one");

    await storage.put(mine, pdf);

    expect(await storage.get(theirs)).toBeNull();
  });

  it("holds bytes that are not text, unchanged, because a PDF is not a string", async () => {
    const storage = build();
    const bytes = new Uint8Array(512);
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 256;
    const object: StoredObject = { bytes, mediaType: "image/jpeg" };

    await storage.put(key, object);

    expect(await storage.get(key)).toEqual(object);
  });

  /**
   * Criterion 3's half that lives in the interface. `ObjectKey` is a compile-time
   * shape, so a caller who composes a string and asserts it past the type is the case
   * that matters, and it is refused at run time rather than reaching the bucket.
   */
  it.each([
    ["a path that climbs out of the prefix", "u/user-one/../user-two/document-one"],
    ["another prefix entirely", "public/user-one/document-one"],
    ["a fourth segment", "u/user-one/nested/document-one"],
    ["an empty user", "u//document-one"],
    ["nothing at all", ""],
  ])("refuses %s", async (_what, outside) => {
    const storage = build();

    await expect(storage.put(outside as ObjectKey, pdf)).rejects.toThrow(/key/i);
    await expect(storage.get(outside as ObjectKey)).rejects.toThrow(/key/i);
    await expect(storage.delete(outside as ObjectKey)).rejects.toThrow(/key/i);
  });
});

describe("the key, which is the only way to reach a prefix", () => {
  it("is always u/<user>/<document>, because keyFor is the only thing that makes one", () => {
    expect(keyFor("user-one", "document-one")).toBe("u/user-one/document-one");
  });

  it("refuses to compose a key out of a value that would reach another prefix", () => {
    expect(() => keyFor("user-one/../user-two", "document-one")).toThrow(/key/i);
  });
});

describe("S3, at its own boundary", () => {
  it("puts into the bucket it was configured with, under the key it was given", async () => {
    const stoodIn = standInFor();
    const storage = createS3Storage({ bucket: "jobapp-dev-documents", calls: stoodIn.calls });

    await storage.put(key, pdf);

    expect(stoodIn.bucketHolds()).toEqual(["jobapp-dev-documents/u/user-one/document-one"]);
  });

  it("takes the object away on a delete, so nothing is left the row does not name", async () => {
    const stoodIn = standInFor();
    const storage = createS3Storage({ bucket: "jobapp-dev-documents", calls: stoodIn.calls });
    await storage.put(key, pdf);

    await storage.delete(key);

    expect(stoodIn.bucketHolds()).toEqual([]);
  });
});
