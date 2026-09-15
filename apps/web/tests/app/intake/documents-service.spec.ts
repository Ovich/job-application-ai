import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Documents } from "../../../src/app/intake/documents/documents";
import {
  documentsAre,
  droppingNext,
  resetIntake,
  rowOf,
  runSays,
  uploadRefused,
} from "../../support/intake";
import { reset } from "../../support/session";

/**
 * `Documents`, the service (D15): the documents and their reading, the only caller of the
 * documents and reading routes.
 *
 * Behind it: the typed client, stood in for at `fetch` (`tests/support/intake.ts`), the
 * reading's event stream included. What is read is the service's own signals and answers.
 *
 * Not past it: the drop zone that draws them, which has its own file, and the routes.
 */

beforeEach(() => {
  reset();
  resetIntake();
  TestBed.configureTestingModule({ providers: [Documents] });
});

afterEach(() => {
  reset();
  resetIntake();
});

const service = (): Documents => TestBed.inject(Documents);

const filenamesOf = (documents: Documents): string[] =>
  documents.documents().map((row) => row.filename);

describe("the documents (D15)", () => {
  it("lists what the route answers, and holds it", async () => {
    documentsAre([
      rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" }),
      rowOf({ id: "two", filename: "BS-HEIGVD-IL-Diplome.pdf" }),
    ]);
    const documents = service();

    const rows = await documents.list();

    expect(rows?.map((row) => row.filename)).toEqual([
      "2026-08-30_cv_FR.pdf",
      "BS-HEIGVD-IL-Diplome.pdf",
    ]);
    expect(filenamesOf(documents)).toEqual(["2026-08-30_cv_FR.pdf", "BS-HEIGVD-IL-Diplome.pdf"]);
  });

  it("adds a file, then an address, each row appearing once the route has it", async () => {
    const documents = service();

    droppingNext("leCVWeb.docx");
    const file = await documents.add(new File(["bytes nothing here reads"], "leCVWeb.docx"));
    droppingNext("unused");
    const address = await documents.add("linkedin.com/in/someone");

    expect(file).toEqual({ row: expect.objectContaining({ filename: "leCVWeb.docx" }) });
    expect("row" in address).toBe(true);
    expect(filenamesOf(documents)).toHaveLength(2);
    expect(filenamesOf(documents)[0]).toBe("leCVWeb.docx");
  });

  it("removes a row", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" })]);
    const documents = service();
    await documents.list();

    await documents.remove("one");

    expect(documents.documents()).toEqual([]);
  });

  it("answers the route's own sentence for a refused add, and adds no row", async () => {
    const documents = service();
    uploadRefused(413, {
      error: "a-scan-of-everything.pdf is larger than 5 MB, which is the most I can take.",
    });

    const added = await documents.add(new File(["bytes"], "a-scan-of-everything.pdf"));

    expect(added).toEqual({
      refusal: "a-scan-of-everything.pdf is larger than 5 MB, which is the most I can take.",
    });
    expect(documents.documents()).toEqual([]);
  });
});

describe("the reading (D15)", () => {
  it("moves each row as its frame says, reads until the run ends, and counts readDone a second after", async () => {
    documentsAre([
      rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" }),
      rowOf({ id: "two", filename: "2026-08-30_cv_EN.pdf" }),
    ]);
    runSays([
      { kind: "document", id: "one", status: "reading", reason: null },
      { kind: "document", id: "one", status: "read", reason: null },
      { kind: "document", id: "two", status: "read", reason: null },
      { kind: "run", status: "done" },
    ]);
    const documents = service();
    await documents.list();

    const running = documents.read();
    expect(documents.reading()).toBe(true);
    const allRead = await running;

    expect(allRead).toBe(true);
    expect(documents.reading()).toBe(false);
    expect(documents.documents().map((row) => row.status)).toEqual(["read", "read"]);
    expect(documents.readDone()).toBe(0);
    await vi.waitFor(() => expect(documents.readDone()).toBe(1), { timeout: 2000 });
  });

  it("answers false, and never counts readDone, when a document could not be read", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_EN.pdf" })]);
    runSays([
      {
        kind: "document",
        id: "one",
        status: "failed",
        reason: "2026-08-30_cv_EN.pdf could not be read.",
      },
      { kind: "run", status: "done" },
    ]);
    const documents = service();
    await documents.list();

    const allRead = await documents.read();

    expect(allRead).toBe(false);
    expect(documents.documents()[0]?.failureReason).toBe("2026-08-30_cv_EN.pdf could not be read.");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(documents.readDone()).toBe(0);
  });
});
