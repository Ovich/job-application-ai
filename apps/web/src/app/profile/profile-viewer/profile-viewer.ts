import {
  afterRenderEffect,
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import type { InferResponseType } from "hono/client";
import { AssistantCore } from "../../assistant/assistant-core";
import { provideAssistant } from "../../assistant/provide-assistant";
import { AppDocuments } from "../../intake/documents/documents";
import { api } from "../../lib/api";
import { UiModal } from "../../ui/modal/modal";
import { UiSpinner } from "../../ui/spinner/spinner";
import { UiText } from "../../ui/typography/text/text";
import { ProfileEditPart } from "../parts/profile-edit-part/profile-edit-part";
import { QuestionAnsweredPart } from "../parts/question-answered-part/question-answered-part";
import { QuestionSkippedPart } from "../parts/question-skipped-part/question-skipped-part";
import { type Pressed, ProfileAssistant } from "../profile-assistant/profile-assistant";
import { ProfileBar } from "../profile-bar/profile-bar";
import type { RegionRef } from "../profile-region/profile-region";
import { ProfileSheet } from "../profile-sheet/profile-sheet";
import { backToHead, revealInColumn, stopFollowing } from "../reveal";

/**
 * The profile viewer (`D5`, `D6`, `ID123`): a route of its own, openable at any time,
 * with no done state and no exit.
 *
 * It is the CV builder's layout, deliberately — the assistant on the left, the document
 * on the right — so the person learns one workbench and the builder inherits a shell
 * already used against real content.
 *
 * **This is the one place that talks to the interface.** The assistant says which
 * question was answered and with what; this class writes it and reads the profile back,
 * so a rule shown under an item is a rule the database agrees with and not one the
 * browser remembered. The class reads the RPC client and the templates bind signals
 * (`AGENTS.md` 3). Types travel Drizzle to `AppType` to `InferResponseType` and arrive
 * inferred; `@app/db` is never reached from the browser.
 *
 * **While a tool is open the profile behaves as the prototype behaves** (`ID125`): the
 * sheet dims, the question's region rises above the overlay and is brought to the middle
 * of the scrolling column, and when the assistant's own run ends the column returns to
 * its head. The arithmetic of that is `profile/reveal`'s and none of it is here.
 */

type Answer = InferResponseType<typeof api.intake.profile.$get, 200>;
type Item = Answer["experience"][number];

@Component({
  selector: "profile-viewer",
  imports: [AppDocuments, ProfileAssistant, ProfileBar, ProfileSheet, UiModal, UiSpinner, UiText],
  templateUrl: "./profile-viewer.html",
  // The profile's assistant, for this screen alone (`ID186`, `ID165`): its own
  // conversation, subject none, and the profile edit's call and record drawn by the part
  // written for them (`ID185`, `ID191`).
  providers: provideAssistant({
    name: "profile",
    parts: [
      { kind: "tool_use", component: ProfileEditPart },
      { kind: "tool_result", component: ProfileEditPart },
      { kind: "question_answered", component: QuestionAnsweredPart },
      { kind: "question_skipped", component: QuestionSkippedPart },
    ],
  }),
  // The layout every assistant screen holds to (the person, 2026-09-12): this fills the
  // page rather than growing past it, so the window never scrolls and each column
  // decides for itself what moves inside it.
  host: { class: "flex min-h-0 flex-1 flex-col" },
})
export class ProfileViewer {
  private readonly router = inject(Router);

  private readonly core = inject(AssistantCore);

  /**
   * Whether the conversation has answered, with its entries or with a refusal. The
   * assistant's column waits for it, because whether the opening is performed is decided
   * from what is stored, once, on its first render (`G3`).
   */
  protected readonly conversationAnswered = computed(
    () => this.core.entries().length > 0 || this.core.failure() !== null,
  );

  protected readonly profile = signal<Answer | null>(null);

  /** Whether a reading has made a profile, which is when the assistant exists (`ID202`). */
  protected readonly read = computed(() => (this.profile()?.documents ?? 0) > 0);

  /** Two columns once there is an assistant; the sheet alone before. */
  protected readonly gridClass = computed(() =>
    [
      "-mt-10 grid h-full min-h-0 flex-1 overflow-hidden",
      this.read() ? "lg:grid-cols-[minmax(440px,42%)_minmax(0,1fr)]" : "",
    ].join(" "),
  );

  /** Whether the drop zone is open over the profile (`ID160`). */
  protected readonly adding = signal(false);

  /** Which column is showing below 1024 px. The profile is what a person came for. */
  protected readonly view = signal<"sheet" | "chat">("sheet");

  /** The last region pressed by hand, which is what opens a tool on it (`US8`). */
  protected readonly selected = signal<RegionRef | null>(null);

  /**
   * Whether the person put the tool down by pressing the dimmed profile. It stays down
   * until they press a region again — otherwise the waiting question, which is still
   * waiting, would open itself the instant it was closed.
   */
  protected readonly dismissed = signal(false);

  /**
   * Which ending the last closed tool was, and the whole of `S5.4`: the profile returns
   * to its head when the **assistant's own run** ends, and stays where the person left
   * it when a clarification does (the mockup's `next(after, viaQuestion)`).
   *
   * A field and not a signal, deliberately: the effect below must not re-run because
   * this moved, only because what is lifted did.
   */
  private viaQuestion = true;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>("scroller");

  protected readonly questions = computed(() => this.profile()?.questions ?? []);

  private readonly waiting = computed(() =>
    this.questions().filter((question) => question.state === "waiting"),
  );

  /** Waiting or skipped: a question whose item still says `scope to clarify`. */
  private readonly stillOpen = computed(() =>
    this.questions().filter((question) => question.state !== "answered"),
  );

  /**
   * The question the assistant has open: the one still open on the item the person
   * pressed, skipped ones included, or the first one waiting when they pressed nothing.
   * The assistant decides the same way from the same two inputs; this is what the sheet
   * is placed by. A line has no question, so a press on one opens its item's never.
   */
  private readonly open = computed(() => {
    const region = this.selected();
    if (region === null) return this.waiting()[0] ?? null;
    if (region.kind === "line") return null;
    return this.stillOpen().find((question) => question.itemId === region.id) ?? null;
  });

  /**
   * The region the person pressed, in its own text, for the tool. An item is itself; a
   * line is the item it belongs to, in the line's own words, with the line's id beside
   * it. `null` when they pressed nothing, or nothing of their profile.
   */
  protected readonly pressed = computed<Pressed | null>(() => {
    const region = this.selected();
    if (region === null) return null;
    return region.kind === "line" ? this.lineOf(region.id) : this.itemOf(region.id);
  });

  /**
   * Which region the sheet lifts: the region the person pressed themselves, line or
   * item, or the open question's item. Nothing is lifted when no tool is open.
   */
  protected readonly lifted = computed(() => {
    const pressed = this.pressed();
    if (pressed !== null) return pressed.lineId ?? pressed.itemId;
    return this.open()?.itemId ?? null;
  });

  /**
   * Whether this is a visit after the reading rather than the run that produced it
   * (`US9`). The documents' own read day is what says so, which is a fact the interface
   * answered and never a guess about the session.
   */
  protected readonly returning = computed(() => {
    const readOn = this.profile()?.readOn ?? null;
    if (readOn === null) return false;
    return new Date(readOn).toDateString() !== new Date().toDateString();
  });

  protected readonly focused = computed(() => this.lifted() !== null);

  /**
   * What the reading produced, for the card's three figures.
   *
   * **`facts` is 0 because the profile cannot honestly count them yet** (`F4`): whether
   * a count of facts can be shown honestly is the spec's own open question, and the card
   * leaves the figure out rather than invent one.
   */
  protected readonly reading = computed(() => ({
    documents: this.profile()?.documents ?? 0,
    facts: 0,
  }));

  /**
   * How many documents this person handed over, once it has been asked for, and `null`
   * until then. Asked only when the profile is empty, which is the one case where the
   * answer decides anything.
   */
  private readonly handedOver = signal<number | null>(null);

  protected readonly state = computed<"loading" | "empty" | "loaded">(() => {
    const profile = this.profile();
    if (profile === null) return "loading";
    const anything =
      profile.summary !== null ||
      profile.identity !== null ||
      profile.experience.length +
        profile.projects.length +
        profile.groups.length +
        profile.education.length >
        0;
    return anything ? "loaded" : "empty";
  });

  /** `From 5 documents, read today`: a count of documents, and when they were read. */
  protected readonly readLine = computed(() => {
    const profile = this.profile();
    if (profile === null || profile.documents === 0) return "";
    const documents = `${profile.documents} document${profile.documents === 1 ? "" : "s"}`;
    return `From ${documents}, read ${this.when(profile.readOn)}`;
  });

  protected readonly name = computed(() => this.profile()?.name ?? "");

  /**
   * Which column is on the screen. Two from 1024 px; below it one at a time, and the
   * bar stays with the sheet's column so the toggle back is never off the screen.
   */
  protected readonly assistantClass = computed(() =>
    [
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-border bg-card max-lg:order-2 lg:flex lg:border-r",
      this.view() === "chat" ? "flex" : "hidden",
    ].join(" "),
  );

  protected readonly scrollClass = computed(() =>
    [
      "min-h-0 flex-1 flex-col items-center overflow-auto p-4 lg:p-7",
      this.view() === "chat" ? "hidden lg:flex" : "flex",
    ].join(" "),
  );

  constructor() {
    void this.load();

    /**
     * The profile's conversation, opened with the opening the API writes the first time
     * (agent-consolidation SL2), **once a reading has made a profile** (`ID202`: no
     * assistant during the intake). An effect, so a reading that lands through the drop
     * zone over this page opens it too.
     */
    let opened = false;
    effect(() => {
      if (opened || !this.read()) return;
      opened = true;
      void this.core.open();
    });

    /**
     * No document and no profile: there is nothing to read here, and a page saying so is
     * a page that makes a person find the way out themselves. The drop zone is the way
     * out, so they are taken to it (the person, 2026-09-12). An effect rather than a line
     * in `load`, because a profile emptied by a deletion has to leave too, not only one
     * that arrived empty.
     *
     * Documents that were read and yielded nothing keep a person here on purpose: the
     * documents screen offers the profile once everything is read, and a profile that
     * bounced back would be the two pages sending each other a person who wanted either.
     */
    effect(() => {
      if (this.state() === "empty" && this.handedOver() === 0) {
        void this.router.navigateByUrl("/documents");
      }
    });

    /**
     * The reveal, redone whenever the lifted region changes — **after the render that
     * draws it**, which is the whole reason this is `afterRenderEffect` and not
     * `effect` (the person, 2026-09-13).
     *
     * The first question opens the moment the profile arrives, so a plain effect ran on
     * that same change and asked the sheet for an item the sheet had not drawn yet. It
     * found nothing, did nothing, and never ran again, because `lifted` never changed
     * a second time: the tool asked about something forty rows down while the column
     * sat at its head. Running after render is not a retry; it is the guarantee that
     * what is being looked for exists.
     *
     * It is an effect and not a
     * handler because the region is a computed over the profile the interface answered:
     * a run that ends, a question that is skipped and a reload all move it, and each of
     * them should place the column the same way.
     */
    afterRenderEffect(() => {
      const column = this.scroller()?.nativeElement;
      const lifted = this.lifted();
      if (column === undefined) return;
      if (lifted === null) {
        // The assistant's own run has ended: the reading is what the person came to see
        // and the last question left them deep inside a list (`ID125`, rule 5). A tool
        // the person opened themselves ends without moving anything (`S5.4`).
        if (this.viaQuestion && this.profile() !== null && this.questions().length > 0) {
          backToHead(column);
        }
        return;
      }
      const region = column.querySelector<HTMLElement>(`[data-id="${lifted}"]`);
      if (region !== null) revealInColumn(column, region);
    });
  }

  private async load(): Promise<void> {
    const answer = await api.intake.profile.$get();
    if (answer.ok) this.profile.set(await answer.json());

    // Only when there is nothing to show: a profile's own count is the documents it
    // cites, which is zero for a person whose reading has not written anything yet —
    // mid-run included. Whether they handed anything over is the documents route's to
    // answer, and it is asked only in the one case that turns on it.
    if (this.state() !== "empty") return;
    const documents = await api.intake.documents.$get();
    this.handedOver.set(documents.ok ? (await documents.json()).length : null);
  }

  /** `today`, or the day itself. Read from the answer; nothing is counted from it. */
  private when(readOn: string | null): string {
    if (readOn === null) return "today";
    const read = new Date(readOn);
    const today = new Date();
    return read.toDateString() === today.toDateString()
      ? "today"
      : `on ${read.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  }

  protected toggleView(): void {
    this.view.update((view) => (view === "sheet" ? "chat" : "sheet"));
  }

  /**
   * A region pressed by hand, item or line. A line lights on hover, so it opens on a
   * press as well (the person, 2026-09-13): the tool opens about the line's own words,
   * and what is written is kept on the item the line belongs to, since a rule hangs from
   * an item and never from a line.
   */
  protected chosen(region: RegionRef): void {
    this.dismissed.set(false);
    this.selected.set(region);
  }

  /**
   * A press on the dimmed profile closes what is open, and decides nothing (the person,
   * 2026-09-13).
   *
   * It used to skip the waiting question, which is a decision — *ask me in the builder*
   * — that nobody made by clicking away from something. Now it puts the tool down: the
   * selection is cleared and the question stays exactly as it was, waiting. Pressing any
   * region opens it again.
   */
  protected overlayPressed(): void {
    if (this.pressed() !== null && this.open() === null) this.cancelled();
    this.selected.set(null);
    this.dismissed.set(true);
  }

  /**
   * What the person wrote about an item nobody asked about, kept as that item's rule
   * (`US8`), and the profile read back so the check line shown is the one the database
   * agrees with. The sheet is left where they opened it: this ending is not the run's.
   */
  protected async clarified(said: {
    itemId: string;
    words: string;
    lineId?: string;
  }): Promise<void> {
    this.viaQuestion = false;
    await api.intake.items[":id"].rule.$post({
      param: { id: said.itemId },
      json: { words: said.words, ...(said.lineId === undefined ? {} : { lineId: said.lineId }) },
    });
    this.selected.set(null);
    await this.load();
  }

  /** The person-opened tool, closed with nothing written and nothing moved. */
  protected cancelled(): void {
    this.viaQuestion = false;
    this.selected.set(null);
  }

  /** Every item of the profile, wherever it hangs, the ones under others included. */
  private items(): Item[] {
    const profile = this.profile();
    if (profile === null) return [];
    const every: Item[] = [];
    const walk = (items: Item[]): void => {
      for (const item of items) {
        every.push(item);
        walk(item.children as Item[]);
      }
    };
    walk([
      ...(profile.summary === null ? [] : [profile.summary]),
      ...(profile.identity === null ? [] : [profile.identity]),
      ...profile.experience,
      ...profile.projects,
      ...profile.groups,
      ...profile.education,
    ]);
    return every;
  }

  /** An item, by its id: where it is, which for an item is its own name. */
  private itemOf(id: string): Pressed | null {
    const item = this.items().find((each) => each.id === id);
    return item === undefined ? null : { itemId: item.id, where: item.title, lineId: null };
  }

  /**
   * A line, as the path to it rather than as itself (the person, 2026-09-13).
   *
   * A bullet is a sentence, sometimes a long one, and repeating it in the tool says
   * twice what the highlight already says once. What the tool needs is where a person
   * is: the post it belongs to, and which row.
   */
  private lineOf(id: string): Pressed | null {
    for (const item of this.items()) {
      const at = item.lines.findIndex((each) => each.id === id);
      if (at !== -1) {
        return { itemId: item.id, where: `${item.title} · row ${at + 1}`, lineId: id };
      }
    }
    return null;
  }

  /** One answer written, and the profile read back, so the rule shown is the rule kept. */
  protected async answered(said: {
    questionId: string;
    optionId?: string;
    words?: string;
  }): Promise<void> {
    this.viaQuestion = true;
    this.selected.set(null);
    await api.intake.questions[":id"].answer.$post({
      param: { id: said.questionId },
      json: {
        ...(said.optionId === undefined ? {} : { optionId: said.optionId }),
        ...(said.words === undefined ? {} : { words: said.words }),
      },
    });
    // The answer is an entry of the conversation now (agent-consolidation `S7.1`), so the
    // conversation is read back with the profile.
    await Promise.all([this.load(), this.core.reload()]);
  }

  protected async skipped(said: { questionId: string }): Promise<void> {
    this.viaQuestion = true;
    this.selected.set(null);
    await api.intake.questions[":id"].answer.$post({
      param: { id: said.questionId },
      json: { skip: true },
    });
    await Promise.all([this.load(), this.core.reload()]);
  }

  /**
   * The drop zone, over the profile rather than instead of it (the person, 2026-09-12).
   * Adding a document is something a person does *to* the profile they are reading, so
   * the page they are reading stays where it is and the drop zone opens on top of it.
   */
  protected addDocuments(): void {
    this.adding.set(true);
  }

  /**
   * The reading inside the modal landed: the drop zone has said its piece in green, so
   * it closes, and the profile it just changed is read back.
   */
  protected async documentsAdded(): Promise<void> {
    this.adding.set(false);
    await this.load();
  }

  /** The observer and the two listeners the reveal set up go with the column. */
  protected stopWatching(): void {
    const column = this.scroller()?.nativeElement;
    if (column !== undefined) stopFollowing(column);
  }
}
