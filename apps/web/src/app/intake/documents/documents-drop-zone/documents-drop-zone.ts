import { Component, computed, inject, input, output, signal } from "@angular/core";
import { Router } from "@angular/router";
import { UiDropZone } from "../../../ui/drop-zone/drop-zone";
import { HlmBtn } from "../../../ui/hlm-button";
import { HlmInput } from "../../../ui/hlm-input";
import { UiBox } from "../../../ui/layout/box/box";
import { UiContainer } from "../../../ui/layout/container/container";
import { UiRow } from "../../../ui/layout/row/row";
import { UiStack } from "../../../ui/layout/stack/stack";
import { AppNotice } from "../../../ui/notice/notice";
import { UiSpinner } from "../../../ui/spinner/spinner";
import { UiText } from "../../../ui/typography/text/text";
import { type Document, Documents } from "../documents";

/**
 * The drop zone, the list and the read button (`ID124`, spec D15), drawn from the
 * injected `Documents`: the documents screen's three states, empty, added and reading.
 * There is no step count, no money and no explainer: one drop zone, one optional field,
 * one retention sentence, one button.
 *
 * The class reads the service and exposes signals; the template reaches no service
 * (`AGENTS.md` 3). A refusal is shown as the route's own sentence, never one invented
 * here: the route knows the limit and which document was already there.
 *
 * The reading's end does not navigate from here: whoever holds the drop zone takes
 * `Documents.readDone` as its moment. What it does offer, once every document is read,
 * is the way to the profile.
 */

/**
 * What a person is told a document is. The column holds the reader's own word; this is
 * how that word is said on a screen. `unknown` is "document", because a row saying
 * "unknown" tells a person their file is a problem when it is not yet a question.
 */
const KIND: Record<string, string> = {
  cv: "CV",
  diploma: "diploma",
  work_certificate: "work certificate",
  linkedin_export: "LinkedIn export",
  photo_of_cv: "photo of a CV",
  unknown: "document",
};

/** The media types the drop zone offers the picker. Anything else still drops fine. */
const accepted =
  ".pdf,.doc,.docx,.odt,.rtf,.txt,.zip,.jpg,.jpeg,.png,.heic,application/pdf,image/*";

@Component({
  selector: "documents-drop-zone",
  imports: [
    AppNotice,
    HlmBtn,
    HlmInput,
    UiBox,
    UiContainer,
    UiDropZone,
    UiRow,
    UiSpinner,
    UiStack,
    UiText,
  ],
  templateUrl: "./documents-drop-zone.html",
})
export class DocumentsDropZone {
  private readonly service = inject(Documents);

  private readonly router = inject(Router);

  protected readonly documents = this.service.documents;

  protected readonly address = signal("");

  /** The route's own sentence for the last refusal, or nothing. */
  protected readonly refusal = signal<string | null>(null);

  /**
   * Whether files a person chose are still on their way up. They go one at a time, and a
   * row appears as each one lands, so a list can look ready while the rest of the
   * selection is still arriving.
   */
  protected readonly uploading = signal(false);

  /** Whether the reading has just landed, which is what the green line says. */
  protected readonly landed = signal(false);

  /**
   * Whether this drop zone is somebody else's content rather than its page's. A modal on
   * the profile renders it (`ID160`); the `/documents` page renders it alone.
   */
  public readonly embedded = input<boolean>(false);

  /** The Done button inside a modal, said to whoever is holding the drop zone. */
  public readonly done = output<void>();

  /**
   * Which of the mockup's three states the screen is in. `reading` is not a flag a
   * person turned on: a row that says `reading` puts the screen there whoever started
   * the run, which is what makes coming back to a tab agree with leaving it.
   *
   * A run that has finished puts the screen back to `added`: the list is a person's
   * documents, not a receipt (the person, 2026-09-12). Only a run still in flight locks it.
   */
  protected readonly state = computed<"empty" | "added" | "reading">(() => {
    const documents = this.documents();
    if (documents.length === 0) return "empty";
    const inFlight = this.service.reading() || documents.some((row) => row.status === "reading");
    return inFlight ? "reading" : "added";
  });

  /** What a run would take: everything the reading has not finished with. */
  protected readonly unread = computed(() =>
    this.documents().filter((row) => row.status !== "read"),
  );

  /**
   * Something unread, or an address, and nothing still on its way up: the whole of the
   * primary button's condition. The run reads the rows that exist when it starts, so a
   * press while the rest of a drop is uploading would read part of what the person chose
   * (`#38`).
   */
  protected readonly ready = computed(
    () => !this.uploading() && (this.unread().length > 0 || this.address().trim() !== ""),
  );

  /**
   * Every document read: the button becomes the way to the profile rather than a disabled
   * control on a page with nothing left to do (the person, 2026-09-12).
   */
  protected readonly allRead = computed(
    () => this.documents().length > 0 && this.unread().length === 0,
  );

  protected readonly failures = computed(() =>
    this.documents()
      .map((row) => row.failureReason)
      .filter((reason): reason is string => reason !== null),
  );

  protected readonly accept = accepted;

  constructor() {
    void this.service.list();
  }

  /**
   * The way onward once every document is read: the profile itself from the page, and
   * nothing but a closed modal from inside one — a person there is already on it.
   */
  protected seeProfile(): void {
    if (this.embedded()) {
      this.done.emit();
      return;
    }
    void this.router.navigateByUrl("/profile");
  }

  /**
   * What a row says on its right: what the reading made of it once there is a reading,
   * and what kind it looks like before then.
   */
  protected sideOf(row: Document): string {
    return row.status === "waiting" ? this.kindOf(row) : row.status;
  }

  /** What a row is called on the screen: the reader's kind, or what the source is. */
  protected kindOf(row: Document): string {
    if (row.source !== "file") return "LinkedIn address";
    return KIND[row.detectedKind ?? "unknown"] ?? "document";
  }

  protected onAddress(event: Event): void {
    this.address.set((event.target as HTMLInputElement).value);
  }

  /** How many drops are still uploading, so a second drop does not end the first's wait. */
  private arriving = 0;

  protected async onFilesChosen(files: File[]): Promise<void> {
    this.refusal.set(null);
    this.arriving += 1;
    this.uploading.set(true);
    try {
      for (const file of files) {
        const added = await this.service.add(file);
        if ("refusal" in added) this.refusal.set(added.refusal);
      }
    } finally {
      // A refused or failed upload still ends the wait: the button comes back for what did
      // land, and the refusal's own sentence says what did not.
      this.arriving -= 1;
      this.uploading.set(this.arriving > 0);
    }
  }

  protected async remove(row: Document): Promise<void> {
    this.refusal.set(null);
    await this.service.remove(row.id);
  }

  /**
   * The run. The typed address, if there is one and it is not a row yet, becomes one
   * first — it is a source like any other — and then the service reads.
   *
   * The word comes when every document is read, and the move a second later, through
   * `readDone`. A run whose documents all failed says so in its own notices and stays.
   */
  protected async read(): Promise<void> {
    const typed = this.address().trim();
    if (typed !== "" && !this.documents().some((row) => row.address === typed)) {
      await this.service.add(typed);
    }
    if (await this.service.read()) this.landed.set(true);
  }
}
