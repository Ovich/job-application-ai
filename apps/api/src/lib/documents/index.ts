import { createHash } from "node:crypto";

/**
 * What a document is called, what it looks like it is, and what makes it the same
 * document twice (`S7.3`, the person's own comment: *"for utility fonctions, let define
 * modules in src/libs. Make modules with clean signature"*).
 *
 * Three pure functions about one subject: a document handed over. Each takes values and
 * returns a value, constructs nothing, reads no configuration and reaches nothing — so
 * a caller needs no database, no storage and no session to use one, and the suite needs
 * none either.
 *
 * **Named for its subject, not for its emptiness.** There is no `lib/utils` here and
 * there will not be: a module named for the fact that nobody could say what it is about
 * is a drawer, and a drawer is where a codebase keeps what it has stopped thinking
 * about. `asMegabytes` — four lines, one caller, a sentence about a limit rather than
 * about a document — stayed where it was used for exactly that reason: moving it would
 * have bought a file and an import and nothing else.
 */

/**
 * What a person is told a document is, before anything has read it.
 *
 * The reading is what decides for real (`POST /read`, through `lib/ai`), and this is
 * what the row says in the meantime, so the list a person sees the instant they drop
 * five files is not five rows saying nothing. It reads the name and the media type and
 * no bytes at all: a person who drops `BS-HEIGVD-IL-Diplome.pdf` should see "diploma"
 * before a model has been anywhere near it.
 *
 * Nothing branches on the answer. It is a column's value, and `linkedin_export` and
 * `photo_of_cv` are in it although the person's own set holds neither, because the
 * product accepts both and the screen draws both (`D20`, `D3`).
 */
export type DetectedKind =
  "cv" | "diploma" | "work_certificate" | "linkedin_export" | "photo_of_cv" | "unknown";

/**
 * The guess before the reading, and it stays (`S7.3` criterion 17, finding `F3`, the
 * person's own question: *"If the llm returns kind, why do we have the other function to
 * detect kind based on string and regex anyway?"*).
 *
 * It is not a rival to the model and it never answers after one: it is what a row says
 * in the second between a drop and a reading, and `apps/web`'s `documents.html` renders
 * `detectedKind` on every row. Deleting it would change what a person sees the instant
 * they drop a file, which is behaviour, and `SL7` changes none. Whether the product
 * should show a guess at all is a design question, and there is an open design review
 * sitting on that exact row at `S2.3`; it rides there, not here.
 */
export const kindOf = (filename: string, mediaType: string): DetectedKind => {
  const name = filename.toLowerCase();
  if (mediaType.startsWith("image/")) return "photo_of_cv";
  if (name.includes("linkedin")) return "linkedin_export";
  if (/dipl[oô]m|bachelor|master|cfc|licence/.test(name)) return "diploma";
  if (/certificat|certificate|attestation|zeugnis/.test(name)) return "work_certificate";
  if (/cv|resume|curriculum|lebenslauf/.test(name)) return "cv";
  return "unknown";
};

/** The digest a duplicate is recognised by: SHA-256 over the bytes, lowercase hex. */
export const hashOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * What a document's own slug is: its filename without the extension (`F1`). Stable
 * across runs, and matchable to a real file by eye in the answer documents' directory.
 */
export const slugOf = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? filename : filename.slice(0, dot);
};
