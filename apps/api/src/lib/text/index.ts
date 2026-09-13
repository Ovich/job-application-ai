import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * What a document says, as text (ID159).
 *
 * The reading sends the AI one composed document rather than one call per file
 * (`ID157`), and a composed document is text: every format a person may hand over has
 * to become characters before anything can be joined. That is this module's whole job —
 * it holds no prompt, calls no model, and knows nothing about profiles.
 *
 * What it cannot do is say so. A format with no text in it — a photograph of a paper CV
 * — is not silently skipped and never invented: `textOf` throws, naming the document and
 * the format, because a document dropped and then quietly ignored is the failure mode
 * the spec's `D20` exists to prevent.
 */

/** One document's contents, and what it is called where a person can recognise it. */
export type Readable = { filename: string; mediaType: string; bytes: Uint8Array };

/**
 * A document read as text, under the name the composition labels it with — the slug the
 * profile's sources cite, so a fact the model attributes to a part can be traced to the
 * row that part came from.
 */
export type Read = { name: string; text: string };

const isPdf = (mediaType: string, filename: string) =>
  mediaType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");

const isWord = (mediaType: string, filename: string) =>
  mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
  filename.toLowerCase().endsWith(".docx");

const isPlain = (mediaType: string, filename: string) =>
  mediaType.startsWith("text/") ||
  mediaType === "application/json" ||
  /\.(txt|md|markdown|json|csv)$/i.test(filename);

/** Spacing a model reads the same way a person does, and no other change to the text. */
const tidied = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * One document as text, whatever it arrived as.
 *
 * Errors: a format this cannot read, and a file whose bytes the reader refuses, both
 * throw naming the document — the caller turns that into what the person is told.
 */
export const textOf = async ({ filename, mediaType, bytes }: Readable): Promise<string> => {
  if (isPdf(mediaType, filename)) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return tidied(Array.isArray(text) ? text.join("\n\n") : text);
  }

  if (isWord(mediaType, filename)) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return tidied(value);
  }

  if (isPlain(mediaType, filename)) return tidied(new TextDecoder().decode(bytes));

  throw new Error(
    `${filename} is a ${mediaType}, which cannot be read as text. A photograph of a document needs a reader that looks at pictures, and this one reads characters.`,
  );
};

/**
 * Every document joined into the one document the reading is a call over (`ID157`).
 *
 * Each part is labelled with the file it came from, and the label is the only thing the
 * composition adds: attribution is what the model is asked to carry back into every
 * fact, so the names it is given must be the names the profile will cite.
 */
export const composed = (documents: Read[]): string =>
  documents
    .map(({ name, text }) => `<<<DOCUMENT ${name}>>>\n${text}`)
    .join("\n\n<<<END>>>\n\n")
    .concat("\n\n<<<END>>>");
