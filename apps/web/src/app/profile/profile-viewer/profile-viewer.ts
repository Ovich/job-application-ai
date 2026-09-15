import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import type { InferResponseType } from "hono/client";
import { AddDocumentsModal } from "../../intake/documents/add-documents-modal/add-documents-modal";
import { Documents } from "../../intake/documents/documents";
import { api } from "../../lib/api";
import { UiSpinner } from "../../ui/spinner/spinner";
import type { Pressed } from "../profile-assistant/profile-assistant";
import { ProfileBar } from "../profile-bar/profile-bar";
import type { RegionRef } from "../profile-region/profile-region";
import { ProfileSheet } from "../profile-sheet/profile-sheet";
import { backToHead, revealInColumn, stopFollowing } from "../reveal";

/**
 * The profile viewer, the right section of `ProfilePage` (`D5`, `D6`, `ID123`, D2, D8):
 * the bar and the sheet, openable at any time, with no done state and no exit.
 *
 * **It reads the profile and holds where the person is on it.** The profile shown is the
 * one the interface answered, read back after each decision the assistant says was kept,
 * so a concern shown under an item is one the database agrees with and not one the browser
 * remembered. The class reads the RPC client and the templates bind signals (`AGENTS.md`
 * 3). Types travel Drizzle to `AppType` to `InferResponseType` and arrive inferred;
 * `@app/db` is never reached from the browser.
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
  imports: [AddDocumentsModal, ProfileBar, ProfileSheet, UiSpinner],
  templateUrl: "./profile-viewer.html",
  // The documents and their reading, for this section and its modal (D15).
  providers: [Documents],
  host: {
    class: "flex min-h-0 flex-col overflow-hidden max-lg:order-1",
    "(document:pointerdown)": "pressedAnywhere($event)",
    "(document:click)": "pressEnded()",
    "(document:keydown.escape)": "escaped()",
  },
})
export class ProfileViewer {
  private readonly router = inject(Router);

  private readonly documents = inject(Documents);

  /** Which column is showing below 1024 px, as the page holds it. */
  public readonly view = input<"sheet" | "chat">("sheet");

  /** The item whose question's tool the assistant activated, handled as a press on it. */
  public readonly activated = input<{ itemId: string } | null>(null);

  /** How many times the person's own tool was put away, written or cancelled. */
  public readonly closed = input<number>(0);

  /** The last decision the assistant made through its tool, and whether it was kept. */
  public readonly decided = input<{ kept: boolean } | null>(null);

  public readonly questions = output<Answer["questions"]>();

  public readonly pressed = output<Pressed | null>();

  public readonly dismissed = output<boolean>();

  public readonly read = output<boolean>();

  public readonly returning = output<boolean>();

  public readonly reading = output<{ documents: number; facts: number }>();

  public readonly toggleView = output<void>();

  protected readonly profile = signal<Answer | null>(null);

  /** Whether a reading has made a profile, which is when the assistant exists (`ID202`). */
  private readonly hasRead = computed(() => (this.profile()?.documents ?? 0) > 0);

  /** Whether the drop zone is open over the profile (`ID160`). */
  protected readonly adding = signal(false);

  /** The last region pressed by hand, which is what opens a tool on it (`US8`). */
  protected readonly selected = signal<RegionRef | null>(null);

  /**
   * Whether the person put the tool down by pressing the dimmed profile. It stays down
   * until they press a region again — otherwise the assistant, which is still waiting on
   * that question, would activate it again the instant it was closed.
   */
  private readonly putDown = signal(false);

  /**
   * Which ending the last closed tool was, and the whole of `S5.4`: the profile returns
   * to its head when the **assistant's own run** ends, and stays where the person left
   * it when a clarification does (the mockup's `next(after, viaQuestion)`). An activation
   * by the assistant is what marks a run (agent-consolidation `SL8`); nothing has before
   * it, so the profile does not move before it either.
   *
   * A field and not a signal, deliberately: the effect below must not re-run because
   * this moved, only because what is lifted did.
   */
  private viaQuestion = false;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>("scroller");

  /** The column the reveal last followed, whose observer and listeners go with this section. */
  private followed: HTMLElement | null = null;

  private readonly asked = computed(() => this.profile()?.questions ?? []);

  private readonly waiting = computed(() =>
    this.asked().filter((question) => question.state === "waiting"),
  );

  /** Waiting or skipped: a question whose item still says `scope to clarify`. */
  private readonly stillOpen = computed(() =>
    this.asked().filter((question) => question.state !== "answered"),
  );

  /**
   * The question whose tool is active: the one still open on the item pressed or
   * activated, skipped ones included, and nothing otherwise — nothing is active by
   * default (agent-consolidation `ID215`). The assistant decides the same way from the
   * same input. A line has no question, so being on one opens its item's never.
   */
  private readonly open = computed(() => {
    const region = this.selected();
    if (region === null || region.kind === "line") return null;
    return this.stillOpen().find((question) => question.itemId === region.id) ?? null;
  });

  /**
   * The region the person pressed, in its own text, for the tool. An item is itself; a
   * line is the item it belongs to, in the line's own words, with the line's id beside
   * it. `null` when they pressed nothing, or nothing of their profile.
   */
  private readonly on = computed<Pressed | null>(() => {
    const region = this.selected();
    if (region === null) return null;
    return region.kind === "line" ? this.lineOf(region.id) : this.itemOf(region.id);
  });

  /**
   * Which region the sheet lifts: the region pressed or activated, line or item. Nothing
   * is lifted when no tool is active.
   */
  protected readonly lifted = computed(() => {
    const on = this.on();
    return on === null ? null : (on.lineId ?? on.itemId);
  });

  /**
   * Whether this is a visit after the reading rather than the run that produced it
   * (`US9`). The documents' own read day is what says so, which is a fact the interface
   * answered and never a guess about the session.
   */
  private readonly isReturning = computed(() => {
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
  private readonly figures = computed(() => ({
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

  protected readonly scrollClass = computed(() =>
    [
      "min-h-0 flex-1 flex-col items-center overflow-auto p-4 lg:p-7",
      this.view() === "chat" ? "hidden lg:flex" : "flex",
    ].join(" "),
  );

  constructor() {
    void this.load();

    // What this section says, relayed by the page to the assistant (D8).
    this.relay(this.asked, (value) => this.questions.emit(value));
    this.relay(this.on, (value) => this.pressed.emit(value));
    this.relay(this.putDown, (value) => this.dismissed.emit(value));
    this.relay(this.hasRead, (value) => this.read.emit(value));
    this.relay(this.isReturning, (value) => this.returning.emit(value));
    this.relay(this.figures, (value) => this.reading.emit(value));

    // What the assistant did, relayed by the page to this section (D8).
    effect(() => {
      const activation = this.activated();
      if (activation !== null) untracked(() => this.activate(activation));
    });
    effect(() => {
      if (this.closed() > 0) untracked(() => this.putAway());
    });
    effect(() => {
      const decision = this.decided();
      if (decision?.kept === true) untracked(() => this.kept());
    });

    /**
     * A reading that landed through the modal, a second after its green line (D15): the
     * modal closes and the profile it just changed is read back.
     */
    effect(() => {
      if (this.documents.readDone() > 0) void untracked(() => this.documentsAdded());
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
      this.followed = column;
      if (lifted === null) {
        // The assistant's own run has ended: the reading is what the person came to see
        // and the last question left them deep inside a list (`ID125`, rule 5). A tool
        // the person opened themselves ends without moving anything (`S5.4`), and so does
        // one between two of the assistant's questions, whose next activation places it.
        if (
          this.viaQuestion &&
          this.profile() !== null &&
          this.asked().length > 0 &&
          this.waiting().length === 0
        ) {
          backToHead(column);
        }
        return;
      }
      const region = column.querySelector<HTMLElement>(`[data-id="${lifted}"]`);
      if (region !== null) revealInColumn(column, region);
    });

    /** The observer and the two listeners the reveal set up go with the section (`ID248`). */
    inject(DestroyRef).onDestroy(() => {
      if (this.followed !== null) stopFollowing(this.followed);
    });
  }

  /** One value of this section, emitted each time it changes. */
  private relay<T>(value: () => T, emit: (value: T) => void): void {
    effect(() => {
      const now = value();
      untracked(() => emit(now));
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
    const documents = await this.documents.list();
    this.handedOver.set(documents === null ? null : documents.length);
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

  /**
   * A region pressed by hand, item or line. A line lights on hover, so it opens on a
   * press as well (the person, 2026-09-13): the tool opens about the line's own words,
   * and what is written is kept on the item the line belongs to, since a concern hangs
   * from an item and never from a line.
   */
  protected chosen(region: RegionRef): void {
    // The click of a press that has just closed a tool opens nothing (`ID236`).
    if (this.swallowing) {
      this.swallowing = false;
      return;
    }
    this.select(region);
  }

  /** The one path a tool is activated by, a press's or the assistant's (`ID215`). */
  private select(region: RegionRef): void {
    this.putDown.set(false);
    this.selected.set(region);
  }

  /**
   * Whether the press under way closed a tool on its way down, so that its click, which a
   * region stops from travelling further, opens nothing where it landed (`ID236`).
   */
  private swallowing = false;

  /**
   * A press anywhere on the page while a tool is active closes it (agent-consolidation
   * `S8.8`, `ID236`), unless it lands in the composer, which holds the dock, or on the
   * lifted region itself. Read on the pointer going down, before the click: a press that
   * lands everything of the performance at once (`G2`) finds no tool yet, so the tool it
   * activates stays.
   */
  protected pressedAnywhere(event: Event): void {
    this.swallowing = false;
    if (this.selected() === null) return;
    const target = event.target;
    if (target instanceof Element) {
      // The view toggle below 1024 px counts like the composer: it is how the tool is reached.
      if (target.closest("composer, [data-action=toggle-view]") !== null) return;
      const region = target.closest("[data-region]")?.getAttribute("data-id") ?? null;
      if (region !== null && region === this.lifted()) return;
    }
    this.swallowing = true;
    this.overlayPressed();
  }

  /** A click that reached the page ends the press: the next one is a press of its own. */
  protected pressEnded(): void {
    this.swallowing = false;
  }

  /** Escape closes the active tool as a press away does (`ID236`). */
  protected escaped(): void {
    if (this.selected() !== null) this.overlayPressed();
  }

  /**
   * A press away closes what is open, and decides nothing (the person, 2026-09-13 and
   * 2026-09-14).
   *
   * It used to skip the waiting question, which is a decision — *ask me in the builder*
   * — that nobody made by clicking away from something. Now it puts the tool down: the
   * selection is cleared and the question stays exactly as it was, waiting. Pressing any
   * region opens it again.
   */
  protected overlayPressed(): void {
    if (this.on() !== null && this.open() === null) this.putAway();
    this.selected.set(null);
    this.putDown.set(true);
  }

  /**
   * The person's own tool put away, written or cancelled: nothing moved. What was written
   * is the assistant's to post, and the sheet is left where they opened it: this ending is
   * not the run's.
   */
  private putAway(): void {
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

  /**
   * The assistant activated a question's tool (agent-consolidation `ID215`, `ID216`):
   * handled as a press on that item, the one path a tool is activated by, and marking the
   * assistant's run so the column returns to its head once no tool is left (`ID125`).
   */
  private activate(activation: { itemId: string }): void {
    this.viaQuestion = true;
    this.select({ kind: "item", id: activation.itemId });
  }

  /**
   * A decision the assistant kept (D5): nothing is active any more, and the profile is read
   * back so the concern shown is the concern kept. The assistant activates what comes next
   * once the new questions arrive.
   */
  private kept(): void {
    this.viaQuestion = true;
    this.selected.set(null);
    void this.load();
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
   * The reading inside the modal landed, or its Done was pressed: the drop zone has said
   * its piece, so it closes, and the profile it just changed is read back.
   */
  protected async documentsAdded(): Promise<void> {
    this.adding.set(false);
    await this.load();
  }
}
