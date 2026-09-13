import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { composed, textOf } from "../../../src/lib/text";

/**
 * Seam: `lib/text`, the module that turns a document a person handed over into the
 * characters the reading is a call over (`ID157`, `ID159`).
 *
 * Behind it: `unpdf` and `mammoth`, and nothing of ours. The cases below are the
 * person's own documents, because a fixture that stands for a real file is what the
 * spec asks for (`D20`) and because a PDF written for a test proves nothing about the
 * PDFs a job seeker actually owns.
 */

const documents = "apps/api/tests/fixtures/documents";

const bytesOf = async (name: string) => new Uint8Array(await readFile(`${documents}/${name}`));

describe("a document read as text", () => {
  it("reads a real CV out of its PDF, whole", async () => {
    const text = await textOf({
      filename: "2026-08-30_cv_EN.pdf",
      mediaType: "application/pdf",
      bytes: await bytesOf("2026-08-30_cv_EN.pdf"),
    });

    // What the document states, from its first line to its last section: a reader that
    // returned the first page alone would pass a length check and fail these.
    expect(text).toContain("Stefan Teofanovic");
    expect(text).toContain("R&D Collaborator in Software Engineering");
    expect(text).toContain("AgenceWeb SA");
    expect(text).toContain("ACM CHI 2024");
    expect(text.length).toBeGreaterThan(5000);
  });

  it("reads a Word document too, because a person hands over what they have", async () => {
    const text = await textOf({
      filename: "leCVWeb.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await bytesOf("leCVWeb.docx"),
    });

    expect(text).toContain("Stefan");
    expect(text.length).toBeGreaterThan(500);
  });

  it("reads plain text as itself", async () => {
    const text = await textOf({
      filename: "notes.txt",
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("Two years at HEIG-VD.\r\n\r\n\r\nKubernetes, mine.  \n"),
    });

    expect(text).toBe("Two years at HEIG-VD.\n\nKubernetes, mine.");
  });

  it("says so rather than skipping a format it cannot read", async () => {
    await expect(
      textOf({
        filename: "photo-of-my-cv.jpg",
        mediaType: "image/jpeg",
        bytes: new Uint8Array([255, 216, 255]),
      }),
    ).rejects.toThrow(/photo-of-my-cv\.jpg is a image\/jpeg/);
  });
});

describe("the documents composed into one", () => {
  it("labels every part with the document it came from, in the order given", () => {
    const one = composed([
      { name: "2026-08-30_cv_EN", text: "The English CV." },
      { name: "BS-HEIGVD-IL-Diplome", text: "The diploma." },
    ]);

    expect(one).toContain("<<<DOCUMENT 2026-08-30_cv_EN>>>\nThe English CV.");
    expect(one).toContain("<<<DOCUMENT BS-HEIGVD-IL-Diplome>>>\nThe diploma.");
    expect(one.indexOf("2026-08-30_cv_EN")).toBeLessThan(one.indexOf("BS-HEIGVD-IL-Diplome"));
  });

  it("adds nothing but the labels", () => {
    const one = composed([{ name: "notes", text: "Kubernetes, mine." }]);

    expect(one).toBe("<<<DOCUMENT notes>>>\nKubernetes, mine.\n\n<<<END>>>");
  });
});
