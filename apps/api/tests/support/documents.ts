import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Document, document } from "@app/db";
import type { ObjectKey, Storage } from "../../src/lib/storage";
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
 * `2026-09-09_cv-en_ownership-application-management.pdf` is the same career written for
 * another kind of post (`ID317`): most of what it holds the English CV already holds, and
 * what it adds is what a second reading has to be able to add.
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
  cvOwnership: {
    filename: "2026-09-09_cv-en_ownership-application-management.pdf",
    from: "cv-generic/2026-09-09_cv-en_ownership-application-management.pdf",
  },
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

/**
 * What a fixture's bytes are, read from the file in this directory and never from
 * `C:\JOBS\`, so the suite passes on a machine that is not the person's laptop.
 *
 * A fixture that is not there says which real document it is and where it came from,
 * because the answer is always the same: copy that file in. It is never to invent one —
 * a case standing for a document nobody has is what `D20` forbids.
 */
export const bytesOfFixture = (filename: string): Uint8Array => {
  try {
    const read = readFileSync(`${fixtures}${filename}`);
    return new Uint8Array(read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength));
  } catch (cause) {
    const from = Object.values(theSet).find((each) => each.filename === filename)?.from;
    throw new Error(
      `The fixture ${filename} is not in apps/api/tests/fixtures/documents/. It is one of the person's own documents${from === undefined ? "" : `, C:\\JOBS\\documents\\${from.replaceAll("/", "\\")}`}: copy it in. Do not invent one (spec D20).`,
      { cause },
    );
  }
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
  body.set("file", new File([bytes], filename, { type: mediaTypeOf(filename) }));
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
 * The bytes a run finds behind a row, by the name on that row.
 *
 * One of the person's seven is its own file. Anything else is a name the suite has no
 * document for, and it is given bytes that are not the format its name claims — which
 * is exactly what a document that cannot become text is now that the reading turns
 * every file into characters before it asks anything (`ID157`, `ID159`). It is never a
 * canned document standing for nothing: it is not a document at all, on purpose.
 */
const bytesBehind = (filename: string): Uint8Array =>
  Object.values(theSet).some((each) => each.filename === filename)
    ? bytesOfFixture(filename)
    : new TextEncoder().encode(`${filename} holds nothing a reader can turn into text`);

/**
 * Rows straight into the database, for a case that is about what happens to a document
 * rather than about how it got there — the reading run, and the resume that reads its
 * rows back. They carry a storage key composed the way the route composes one, so a run
 * over them reaches the storage the same way.
 *
 * **The bytes go in beside the row when a storage is handed over**, and a run needs
 * them: the reading reads each file as text itself before it asks anything (`ID157`),
 * so a row whose object is absent is a document that fails rather than one that is read.
 * A case about the rows alone — a listing, a removal — passes no storage and gets none.
 */
export const documentsFor = async (
  userId: string,
  filenames: readonly string[],
  storage?: Storage,
): Promise<Document[]> => {
  const rows = await testDb
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

  if (storage !== undefined) {
    for (const row of rows) {
      if (row.storageKey === null) continue;
      await storage.put(row.storageKey as ObjectKey, {
        bytes: bytesBehind(row.filename),
        mediaType: row.mediaType,
      });
    }
  }
  return rows;
};
