import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { document, type Document } from "@app/db";
import { testDb } from "./database";

/**
 * The suite's own document support (ID129, on SL1's precedent).
 *
 * It hides two things: the assembly of a multipart body, which every upload case needs
 * and none of them is about, and the fixture files' bytes.
 *
 * **The fixture set is the person's own documents**, copied out of `C:\JOBS\documents\`
 * and committed here, so the suite passes on any machine and not only on that laptop
 * (spec `D20`, and the slice's "what is already known"). A case therefore stands for a
 * real file: `2026-08-30_cv_FR.pdf` and `2026-08-30_cv_EN.pdf` are the same person in
 * two languages in one month, `leCVWeb.docx` is Word and an older year that disagrees
 * with them, `CV-2025.pdf` is the largest the person has at 4.3 MB, and the diploma and
 * the work certificate are two kinds that are not a CV at all.
 *
 * **There is no LinkedIn export file and no photograph of a paper CV**, because the
 * person has neither. Both stay kinds the column accepts and the screen can draw, with
 * no canned case behind them; the LinkedIn path this slice proves is the typed address,
 * which needs no document at all (`D20`, `US2`).
 */

const fixtures = fileURLToPath(new URL("../fixtures/documents/", import.meta.url));

/** What the person's own set is made of, each named by the file it was copied from. */
export const theSet = {
  cvFrench: { filename: "2026-08-30_cv_FR.pdf", from: "cv-generic/2026-08-30_cv_FR.pdf" },
  cvEnglish: { filename: "2026-08-30_cv_EN.pdf", from: "cv-generic/2026-08-30_cv_EN.pdf" },
  cvWord2022: { filename: "leCVWeb.docx", from: "cv-archive/2022/leCVWeb.docx" },
  cv2025: { filename: "CV-2025.pdf", from: "cv-archive/2025/CV-2025.pdf" },
  diploma: {
    filename: "BS-HEIGVD-IL-Diplome.pdf",
    from: "diplomas/BS-HEIGVD-IL-Diplome.pdf",
  },
  workCertificate: {
    filename: "certificat_travail.pdf",
    from: "work-certificates/certificat_travail.pdf",
  },
} as const;

/** The five `US1` drops in one gesture: two PDFs, a Word file, a big one, a diploma. */
export const fiveOfThem = [
  theSet.cvFrench,
  theSet.cvEnglish,
  theSet.cvWord2022,
  theSet.cv2025,
  theSet.diploma,
] as const;

/** What a fixture's bytes are, read from the committed file and never from `C:\JOBS\`. */
export const bytesOfFixture = (filename: string): Uint8Array => {
  const read = readFileSync(`${fixtures}${filename}`);
  return new Uint8Array(read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength));
};

/** What a browser says a file is, from its name, as the media types this screen accepts. */
const mediaTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  jpg: "image/jpeg",
  png: "image/png",
  zip: "application/zip",
};

const mediaTypeOf = (filename: string): string =>
  mediaTypes[filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()] ??
  "application/octet-stream";

/**
 * One upload, as a browser sends it: a multipart body with the file under `file`. The
 * bytes are whatever the caller hands over, so a case about size can pass bytes that no
 * file has and a case about a real document can pass a real one.
 */
export const uploadOf = (bytes: Uint8Array, filename: string): FormData => {
  const body = new FormData();
  body.set("file", new File([bytes as BlobPart], filename, { type: mediaTypeOf(filename) }));
  return body;
};

/** One upload of a fixture, by its name in the set. */
export const uploadOfFixture = (filename: string): FormData =>
  uploadOf(bytesOfFixture(filename), filename);

/** A typed LinkedIn address and nothing else, the one source with no bytes (`US2`, `D3`). */
export const uploadOfAddress = (address: string): FormData => {
  const body = new FormData();
  body.set("address", address);
  return body;
};

/**
 * Rows straight into the database, for a case that is about what happens to a document
 * rather than about how it got there — the reading run, and the resume that reads its
 * rows back. They carry a storage key composed the way the route composes one, so a run
 * over them reaches the storage the same way.
 */
export const documentsFor = async (
  userId: string,
  filenames: readonly string[],
): Promise<Document[]> =>
  testDb
    .insert(document)
    .values(
      filenames.map((filename, at) => ({
        id: `${userId}-document-${at}`,
        userId,
        filename,
        mediaType: mediaTypeOf(filename),
        source: "file",
        storageKey: `u/${userId}/${userId}-document-${at}`,
        contentHash: `hash-of-${filename}-for-${userId}`,
        status: "waiting",
      })),
    )
    .returning();
