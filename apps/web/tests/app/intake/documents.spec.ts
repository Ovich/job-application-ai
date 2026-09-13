import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import {
  documentsAre,
  droppingNext,
  holdingNextUpload,
  intakeRequests,
  itemOf,
  profileIs,
  resetIntake,
  rowOf,
  runSays,
  uploadRefused,
} from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * Seam C: the documents screen, rendered (criteria 7, 8, 11).
 *
 * Behind it: the RPC client, stood in for at `lib/api`'s seam the way the shell already
 * stands the library in (`tests/support/session.ts`, `tests/support/intake.ts`). No
 * network, and no drop of a real file — the end-to-end spec does that.
 *
 * Not past it: the component's fields and its template's tags. Every assertion reads the
 * text a person reads and presses the buttons a person presses, which is what makes the
 * three states of the mockup testable by state and the look reviewable against it.
 */

const person = {
  name: "Stefan Teofanovic",
  email: "stefan@example.com",
  providers: ["google" as const],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  reset();
  resetIntake();
  signedInAs(person);
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
});

afterEach(() => {
  reset();
  resetIntake();
});

const opened = async () => {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl("/documents");
  const page = () => harness.routeNativeElement;
  const buttonSaying = (label: string) =>
    Array.from(page()?.querySelectorAll("button") ?? []).find(
      (button) => textOf(button) === label,
    ) as HTMLButtonElement | undefined;
  const read = () => buttonSaying("Read my documents");
  /** A button a person finds by its accessible name rather than by its glyph. */
  const buttonLabelled = (label: string) =>
    page()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined;
  // A row's own two pieces of text: what the document is called, and what is said of
  // it. The glyphs beside them are drawn shapes and carry no text at all, which is also
  // why a screen reader is not told a tick.
  const rows = () =>
    Array.from(page()?.querySelectorAll("[data-row=document]") ?? []).map((row) => {
      const [name, said] = Array.from(row.querySelectorAll(":scope > span"));
      return `${textOf(name)} ${textOf(said)}`.trim();
    });
  const field = () => page()?.querySelector("input[type=url]") as HTMLInputElement | undefined;
  /** The documents screen itself, without the shell's bar above it. */
  const screen = () => page()?.querySelector("app-documents");
  const settle = async () => {
    await vi.waitFor(() => expect(page()).not.toBeNull());
    harness.detectChanges();
    await Promise.resolve();
    harness.detectChanges();
  };
  /** An assertion that is true once the screen has caught up with what it asked for. */
  const eventually = (assert: () => void) =>
    vi.waitFor(() => {
      harness.detectChanges();
      assert();
    });
  await settle();
  return {
    harness,
    page,
    screen,
    read,
    rows,
    field,
    buttonSaying,
    buttonLabelled,
    settle,
    eventually,
  };
};

/** A drop of files, as the drop zone emits it: the zone's own output, not a real drop. */
const dropOf = (page: HTMLElement | null, files: File[]): void => {
  const zone = page?.querySelector("ui-drop-zone > *") as HTMLElement;
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  zone.dispatchEvent(event);
};

const fileNamed = (name: string) => new File(["bytes nothing here reads"], name);

describe("the documents screen, empty (criterion 8)", () => {
  it("says what it is for, in the words the mockup approved", async () => {
    const screen = await opened();

    expect(textOf(screen.page())).toContain("Start with what you already have");
    expect(textOf(screen.page())).toContain(
      "Every CV you ever wrote tells a different part of the story.",
    );
    expect(textOf(screen.page())).toContain(
      "No file? Your LinkedIn page alone works, and so does a photo of a paper CV.",
    );
  });

  it("shows the drop zone, the field and the retention line", async () => {
    const screen = await opened();

    expect(textOf(screen.page())).toContain("Drop everything here");
    expect(screen.field()?.placeholder).toBe("linkedin.com/in/…");
    expect(textOf(screen.page())).toContain(
      "Your documents are read once, into your profile. They stay only so you can see where each fact came from, and they go when you delete your account.",
    );
  });

  it("has the primary button disabled until there is something to read", async () => {
    const screen = await opened();

    expect(screen.read()?.disabled).toBe(true);
  });

  /**
   * `D4`, and the audit's major finding: no money anywhere in the intake. The meter in
   * the AppBar is the one figure the product shows, and it is the bar's, not this
   * screen's — so the screen itself is what is read here.
   */
  it("says nothing about money and counts no steps", async () => {
    const screen = await opened();

    expect(textOf(screen.screen())).not.toMatch(/CHF|credit|price|cost|free|step \d|\d of \d/i);
  });
});

describe("the documents screen, with documents added (US1, criterion 8)", () => {
  it("shows a row per document with the kind the reader detected", async () => {
    documentsAre([
      rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf", detectedKind: "cv" }),
      rowOf({ id: "two", filename: "BS-HEIGVD-IL-Diplome.pdf", detectedKind: "diploma" }),
    ]);

    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.rows()).toEqual([
        "2026-08-30_cv_FR.pdf CV",
        "BS-HEIGVD-IL-Diplome.pdf diploma",
      ]);
      expect(screen.buttonLabelled("Remove 2026-08-30_cv_FR.pdf")).toBeDefined();
    });
  });

  it("enables the primary button, and says how long it takes", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" })]);

    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
      expect(textOf(screen.page())).toContain(
        "About two minutes. You can leave, the reading goes on.",
      );
    });
  });

  it("uploads what was dropped and shows it as a row", async () => {
    const screen = await opened();
    droppingNext("leCVWeb.docx");

    dropOf(screen.page(), [fileNamed("leCVWeb.docx")]);

    await screen.eventually(() => {
      expect(screen.rows().join(" ")).toContain("leCVWeb.docx");
    });
    expect(intakeRequests().filter((each) => each.method === "POST")).toHaveLength(1);
  });

  /**
   * A drop still arriving is not yet something to read. The run reads the rows that exist
   * when it starts, and files go up one at a time, so with one document already here the
   * button was on while the rest of a drop was still uploading — and a press then read
   * part of what the person chose. It is also what made `intake-questions` flaky: the
   * spec pressed Read the moment it could, and on a slow runner that moment came before
   * a 4.5 MB CV had landed.
   */
  it("keeps Read off while a drop is still uploading, even with a document already here", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" })]);
    const screen = await opened();
    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
    });

    droppingNext("CV-2025.pdf");
    const land = holdingNextUpload();
    dropOf(screen.page(), [fileNamed("CV-2025.pdf")]);

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(true);
    });

    land();

    await screen.eventually(() => {
      expect(screen.rows().join(" ")).toContain("CV-2025.pdf");
      expect(screen.read()?.disabled).toBe(false);
    });
  });

  it("removes a row when the remove is pressed, and disables the button on the last one", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" })]);
    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.buttonLabelled("Remove 2026-08-30_cv_FR.pdf")).toBeDefined();
    });
    screen.buttonLabelled("Remove 2026-08-30_cv_FR.pdf")?.click();

    await screen.eventually(() => {
      expect(screen.rows()).toEqual([]);
      expect(screen.read()?.disabled).toBe(true);
    });
  });

  /**
   * A refusal is the route's own sentence, shown as it arrived, never one invented in
   * the browser: the limit and the file are in it because the route put them there.
   */
  it("shows the route's own sentence when an upload is refused", async () => {
    const screen = await opened();
    uploadRefused(413, {
      error: "a-scan-of-everything.pdf is larger than 5 MB, which is the most I can take.",
    });

    dropOf(screen.page(), [fileNamed("a-scan-of-everything.pdf")]);

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain(
        "a-scan-of-everything.pdf is larger than 5 MB, which is the most I can take.",
      );
    });
  });

  it("shows the duplicate's own sentence too", async () => {
    const screen = await opened();
    uploadRefused(409, { error: "2026-08-30_cv_EN.pdf is already here.", documentId: "one" });

    dropOf(screen.page(), [fileNamed("a-copy.pdf")]);

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain("2026-08-30_cv_EN.pdf is already here.");
    });
  });
});

describe("a typed address and no file at all (US2, criterion 7)", () => {
  it("enables the primary button on the address alone", async () => {
    const screen = await opened();
    const field = screen.field();
    if (field === undefined) throw new Error("no LinkedIn field on the screen");

    field.value = "linkedin.com/in/someone";
    field.dispatchEvent(new Event("input"));

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
    });
  });

  it("says what it will do with it, before anyone asks", async () => {
    const screen = await opened();

    expect(textOf(screen.page())).toContain("Your LinkedIn address · optional");
  });
});

describe("the reading (US3, criterion 8)", () => {
  const two = [
    rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" }),
    rowOf({ id: "two", filename: "2026-08-30_cv_EN.pdf" }),
  ];

  it("turns the same screen into one row per document, and says a person may leave", async () => {
    documentsAre(two);
    runSays([
      { kind: "document", id: "one", status: "reading", reason: null },
      { kind: "document", id: "one", status: "read", reason: null },
      { kind: "document", id: "two", status: "reading", reason: null },
      { kind: "document", id: "two", status: "read", reason: null },
      { kind: "run", status: "done" },
    ]);
    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
    });
    screen.read()?.click();

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain(
        "You can leave this page. Your profile opens on its own when the reading is done.",
      );
    });
  });

  it("ends on a row for putting them together, and never navigates away", async () => {
    documentsAre(two);
    runSays([{ kind: "run", status: "done" }]);
    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
    });
    screen.read()?.click();

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain("Put it together");
      expect(textOf(screen.page())).toContain("one profile, every fact with its source");
    });
  });

  it("shows a document that could not be read as failed, and the others as read", async () => {
    documentsAre([
      rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf" }),
      rowOf({ id: "two", filename: "a-document-nobody-recorded.pdf" }),
    ]);
    runSays([
      { kind: "document", id: "one", status: "read", reason: null },
      {
        kind: "document",
        id: "two",
        status: "failed",
        reason: "a-document-nobody-recorded.pdf could not be read. The others were.",
      },
      { kind: "run", status: "done" },
    ]);
    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.read()?.disabled).toBe(false);
    });
    screen.read()?.click();

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain(
        "a-document-nobody-recorded.pdf could not be read. The others were.",
      );
    });
  });
});

/**
 * Criterion 11. The screen is right because the rows are right, and for no other reason:
 * there is no run id in the browser, nothing in `localStorage`, and no reconnect that
 * replays frames from memory. A reload mid-run is a fresh screen reading the list route.
 */
describe("a reload mid-run (criterion 11, US3)", () => {
  it("shows waiting, reading and read exactly as the database has them", async () => {
    documentsAre([
      rowOf({
        id: "one",
        filename: "2026-08-30_cv_FR.pdf",
        status: "read",
        readAt: "2026-09-12T10:00:00.000Z",
      }),
      rowOf({ id: "two", filename: "2026-08-30_cv_EN.pdf", status: "reading" }),
      rowOf({ id: "three", filename: "BS-HEIGVD-IL-Diplome.pdf", status: "waiting" }),
    ]);

    // The profile these two documents made: a viewer asked for one that is empty *and*
    // made of no document sends a person back here, which is right for somebody who has
    // never dropped anything and wrong for somebody who just read two.
    profileIs({
      documents: 2,
      summary: itemOf({ id: "summary", kind: "summary", title: "Someone." }),
    });

    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.rows()).toEqual([
        "2026-08-30_cv_FR.pdf read",
        "2026-08-30_cv_EN.pdf reading",
        "BS-HEIGVD-IL-Diplome.pdf waiting",
      ]);
    });
  });

  it("remembers nothing of its own: the list route is the only thing it asked", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_FR.pdf", status: "reading" })]);

    const screen = await opened();
    await screen.eventually(() => {
      expect(screen.rows()).toHaveLength(1);
    });

    expect(intakeRequests()).toEqual([{ method: "GET", address: "/api/intake/documents" }]);
    expect(Object.keys(globalThis.localStorage ?? {})).toEqual([]);
  });
});

/**
 * The upload page is a list a person keeps: a reading that has finished gives it back,
 * with the way to what the reading made (the person, 2026-09-12).
 */
describe("documents already read", () => {
  it("hands the list back, and offers the profile instead of a dead button", async () => {
    documentsAre([
      rowOf({
        id: "one",
        filename: "2026-08-30_cv_FR.pdf",
        status: "read",
        readAt: "2026-09-12T10:00:00.000Z",
      }),
      rowOf({
        id: "two",
        filename: "BS-HEIGVD-IL-Diplome.pdf",
        status: "read",
        readAt: "2026-09-12T10:00:00.000Z",
      }),
    ]);

    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.rows()).toEqual(["2026-08-30_cv_FR.pdf read", "BS-HEIGVD-IL-Diplome.pdf read"]);
      expect(screen.buttonLabelled("Remove 2026-08-30_cv_FR.pdf")).not.toBeUndefined();
      expect(screen.page()?.querySelector("ui-drop-zone")).not.toBeNull();
      expect(screen.read()).toBeUndefined();
      expect(screen.buttonSaying("See my profile")).not.toBeUndefined();
    });

    // Where it goes, rather than where the harness ends up: the assertion is about this
    // screen's own doing, and a router that then loads the viewer is SL3's business.
    const going = vi.spyOn(TestBed.inject(Router), "navigateByUrl");
    screen.buttonSaying("See my profile")?.click();

    expect(going).toHaveBeenCalledWith("/profile");
  });

  it("reads a failed document again, because a run takes everything not read", async () => {
    documentsAre([
      rowOf({
        id: "one",
        filename: "2026-08-30_cv_FR.pdf",
        status: "read",
        readAt: "2026-09-12T10:00:00.000Z",
      }),
      rowOf({ id: "two", filename: "a-document-nobody-recorded.pdf", status: "failed" }),
    ]);

    const screen = await opened();

    await screen.eventually(() => {
      expect(screen.buttonSaying("See my profile")).toBeUndefined();
      expect(screen.read()?.disabled).toBe(false);
    });
  });
});

/**
 * What happens the moment a reading lands (the person, 2026-09-12): a green line, and a
 * second later the profile it made.
 */
describe("the reading lands", () => {
  it("says so in green, then opens the profile a second later", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_EN.pdf" })]);
    runSays([
      { kind: "document", id: "one", status: "reading", reason: null },
      { kind: "document", id: "one", status: "read", reason: null },
      { kind: "run", status: "done" },
    ]);
    const screen = await opened();
    const going = vi.spyOn(TestBed.inject(Router), "navigateByUrl");

    await screen.eventually(() => expect(screen.read()?.disabled).toBe(false));
    screen.read()?.click();

    // The word first, and the page still where the person left it.
    await screen.eventually(() => {
      const notice = screen.page()?.querySelector('app-notice[role="status"]');
      expect(textOf(notice)).toContain("Read.");
      expect(textOf(notice)).toContain("Opening your profile.");
    });
    expect(going).not.toHaveBeenCalled();

    // Then the move, and only then.
    await vi.waitFor(() => expect(going).toHaveBeenCalledWith("/profile"), { timeout: 4000 });
  });

  it("stays where it is when the reading failed, because there is nothing to open", async () => {
    documentsAre([rowOf({ id: "one", filename: "2026-08-30_cv_EN.pdf" })]);
    runSays([
      { kind: "document", id: "one", status: "reading", reason: null },
      {
        kind: "document",
        id: "one",
        status: "failed",
        reason: "2026-08-30_cv_EN.pdf could not be read.",
      },
      { kind: "run", status: "done" },
    ]);
    const screen = await opened();
    const going = vi.spyOn(TestBed.inject(Router), "navigateByUrl");

    await screen.eventually(() => expect(screen.read()?.disabled).toBe(false));
    screen.read()?.click();

    await screen.eventually(() => {
      expect(textOf(screen.page())).toContain("could not be read");
    });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(going).not.toHaveBeenCalled();
    expect(screen.page()?.querySelector('app-notice[role="status"]')).toBeNull();
  });
});
