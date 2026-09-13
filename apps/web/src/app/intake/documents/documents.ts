import { Component, computed, inject, input, output, signal } from "@angular/core";
import { Router } from "@angular/router";
import type { InferResponseType } from "hono/client";
import { api } from "../../lib/api";
import { UiDropZone } from "../../ui/drop-zone/drop-zone";
import { HlmBtn } from "../../ui/hlm-button";
import { HlmInput } from "../../ui/hlm-input";
import { UiBox } from "../../ui/layout/box/box";
import { UiContainer } from "../../ui/layout/container/container";
import { UiRow } from "../../ui/layout/row/row";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppNotice } from "../../ui/notice/notice";
import { UiSpinner } from "../../ui/spinner/spinner";
import { UiText } from "../../ui/typography/text/text";

/**
 * The documents screen (`ID124`, `D1`, `D3`, `D4`): the first thing a person does with
 * this product after signing in, and the only screen the intake has.
 *
 * One screen, three states — empty, added, reading — and the reading is a state of this
 * same screen rather than a page of its own. There is no step count, no money and no
 * explainer: one drop zone, one optional field, one retention sentence, one button.
 *
 * **Its state is the rows.** The list route is asked when the screen opens and that is
 * the whole of the resume: a person who closed the tab mid-reading comes back to what
 * the database says, not to what a browser remembered. Nothing is kept in
 * `localStorage`, there is no run id here, and a stream that is cut is not replayed —
 * it is read again from the rows.
 *
 * The class reads the client and exposes signals; the template reaches no service
 * (`AGENTS.md` 3), so every state below is tested by setting a signal. A refusal is
 * shown as the route's own sentence, never one invented here: the route knows the limit
 * and which document was already there, and this screen does not.
 *
 * The reading's end does not navigate on its own: a person may have left the tab, and a
 * page that jumps under them is a page that took the decision. What it does offer, once
 * every document is read, is the way to the profile — the thing they came here to make.
 */

/** How long the green line stands before the profile opens (the person, 2026-09-12). */
const afterTheReading = 1000;

/** A row, as the list route answers it. Inferred; nothing about it is declared here. */
type Document = InferResponseType<typeof api.intake.documents.$get, 200>[number];

/** What a leaf of the reading run says. Inferred from the catalogue the API ships. */
type Leaf = {
  kind: string;
  id?: string;
  status?: string;
  reason?: string | null;
};

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
  selector: "app-documents",
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
  templateUrl: "./documents.html",
})
export class AppDocuments {
  protected readonly documents = signal<Document[]>([]);

  protected readonly address = signal("");

  /**
   * Whether a run started here is still going. A reload finds it in the rows instead,
   * and the end of the stream puts it back down: a run that has finished leaves the
   * screen editable, the same as one nobody started.
   */
  protected readonly started = signal(false);

  /** The route's own sentence for the last refusal, or nothing. */
  protected readonly refusal = signal<string | null>(null);

  /** Whether the reading has just landed, which is what the green line says. */
  protected readonly landed = signal(false);

  /**
   * Whether this screen is somebody else's content rather than its own page. A modal on
   * the profile renders it (`ID160`); the route renders it alone.
   */
  public readonly embedded = input<boolean>(false);

  /**
   * The reading landed, said to whoever is holding this screen. The route takes it as
   * the moment to open the profile; a modal takes it as the moment to close and read
   * the profile back. Neither decision belongs here.
   */
  public readonly done = output<void>();

  /**
   * Which of the mockup's three states the screen is in. `reading` is not a flag a
   * person turned on: a row that says `reading` puts the screen there whoever started
   * the run, which is what makes coming back to a tab agree with leaving it.
   *
   * A run that has finished puts the screen back to `added`, not `reading`: the list is
   * a person's documents, not a receipt, and they add to it and take from it whenever
   * they like (the person, 2026-09-12). Only a run still in flight locks it.
   */
  protected readonly state = computed<"empty" | "added" | "reading">(() => {
    const documents = this.documents();
    if (documents.length === 0) return "empty";
    const inFlight = this.started() || documents.some((row) => row.status === "reading");
    return inFlight ? "reading" : "added";
  });

  /** What a run would take: everything the reading has not finished with. */
  protected readonly unread = computed(() =>
    this.documents().filter((row) => row.status !== "read"),
  );

  /**
   * Something unread, or an address: the whole of the primary button's condition. The
   * run reads every row that is not `read` — a failed one included, which is how a
   * failure is tried again — so what leaves the button off is a list with nothing left
   * to read.
   */
  protected readonly ready = computed(
    () => this.unread().length > 0 || this.address().trim() !== "",
  );

  /**
   * Every document read: there is nothing to press Read for, and the thing a person came
   * here to make now exists. The button becomes the way to it rather than a disabled
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

  private readonly router = inject(Router);

  constructor() {
    void this.load();
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

  /** The list route, which is the screen's whole memory. */
  private async load(): Promise<void> {
    const answer = await api.intake.documents.$get();
    if (answer.ok) this.documents.set(await answer.json());
  }

  protected async onFilesChosen(files: File[]): Promise<void> {
    this.refusal.set(null);
    for (const file of files) {
      const answer = await api.intake.documents.$post({ form: { file } });
      const said = (await answer.json()) as Document & { error?: string };
      if (answer.ok) {
        this.documents.update((rows) => [...rows, said]);
      } else {
        this.refusal.set(said.error ?? null);
      }
    }
  }

  protected async remove(row: Document): Promise<void> {
    this.refusal.set(null);
    const answer = await api.intake.documents[":id"].$delete({ param: { id: row.id } });
    if (answer.ok) this.documents.update((rows) => rows.filter((each) => each.id !== row.id));
  }

  /**
   * The run. The typed address, if there is one and it is not a row yet, becomes one
   * first — it is a source like any other — and then the stream is read frame by frame.
   *
   * Each frame moves one row, because each frame is a row the API has already written.
   * When the run says it is done the list is read once more, for the kinds and the
   * languages the reader detected, which the frames deliberately do not carry.
   */
  protected async read(): Promise<void> {
    const typed = this.address().trim();
    if (typed !== "" && !this.documents().some((row) => row.address === typed)) {
      const answer = await api.intake.documents.$post({ form: { address: typed } });
      if (answer.ok) {
        const row = (await answer.json()) as Document;
        this.documents.update((rows) => [...rows, row]);
      }
    }

    this.started.set(true);
    const run = await api.intake.read.$post();
    const body = run.body;
    if (body === null) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let held = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      held += decoder.decode(next.value, { stream: true });
      const blocks = held.split("\n\n");
      held = blocks.pop() ?? "";
      for (const block of blocks) this.apply(block);
    }

    // The stream is over, so nothing is in flight any more: the list goes back to being
    // one a person keeps. `load` has the rows as the run left them, and `started` is the
    // only thing that would still say otherwise.
    this.started.set(false);
    await this.load();

    /**
     * The reading landed, so the person is taken to what it made (the person,
     * 2026-09-12). The word comes first and the move a second later: a screen that
     * jumps the instant a run ends leaves nobody sure it worked, and a second is long
     * enough to read four words and short enough not to be a wait.
     *
     * Only when something was actually read. A run whose documents all failed says so
     * in its own notices and stays where it is, because there is nothing to go to.
     */
    if (this.allRead()) {
      this.landed.set(true);
      setTimeout(() => {
        this.done.emit();
        if (!this.embedded()) void this.router.navigateByUrl("/profile");
      }, afterTheReading);
    }
  }

  /** One block of the stream, if it carries a leaf this screen draws. */
  private apply(block: string): void {
    const line = block.split("\n").find((each) => each.startsWith("data: "));
    if (line === undefined) return;
    let leaf: Leaf;
    try {
      leaf = (JSON.parse(line.slice("data: ".length)) as { leaf: Leaf }).leaf;
    } catch {
      return;
    }
    if (leaf.kind !== "document" || leaf.id === undefined) return;
    this.documents.update((rows) =>
      rows.map((row) =>
        row.id === leaf.id
          ? { ...row, status: leaf.status ?? row.status, failureReason: leaf.reason ?? null }
          : row,
      ),
    );
  }
}
