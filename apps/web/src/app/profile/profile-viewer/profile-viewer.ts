import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
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
import { ProfileBar } from "../profile-bar/profile-bar";
import type { RegionRef } from "../profile-region/profile-region";
import { ProfileSheet } from "../profile-sheet/profile-sheet";
import { revealInColumn, stopFollowing } from "../reveal";

/**
 * The profile viewer, the whole of `ProfilePage` (`D5`, `D6`, `ID123`, D2, `ID331`):
 * the bar and the sheet, openable at any time, with no done state and no exit.
 *
 * **Nothing asks here** (product-flow-rework `S2.1`, `H13`). It used to be the right
 * section of a two-column page and to relay six things out to the assistant on the left
 * and take three back; the assistant has left the intake, so those relays are gone and
 * this section imports nothing of it. What is left is what a person came for.
 *
 * **It reads the profile and holds where the person is on it.** The profile shown is the
 * one the interface answered, read back after each reading that changes it, so what is
 * under an item is what the database agrees with and not what the browser remembered. The
 * class reads the RPC client and the templates bind signals (`AGENTS.md`
 * 3). Types travel Drizzle to `AppType` to `InferResponseType` and arrive inferred;
 * `@app/db` is never reached from the browser.
 *
 * **While a region is held the profile behaves as the prototype behaves** (`ID125`): the
 * sheet dims, the region rises above the overlay and is brought to the middle of the
 * scrolling column. The arithmetic of that is `profile/reveal`'s and none of it is here.
 */

type Answer = InferResponseType<typeof api.intake.profile.$get, 200>;
type Item = Answer["experience"][number];

/** Where a press landed: the item it belongs to, and the line itself when it was one. */
type Held = { itemId: string; lineId: string | null };

@Component({
  selector: "profile-viewer",
  imports: [AddDocumentsModal, ProfileBar, ProfileSheet, UiSpinner],
  templateUrl: "./profile-viewer.html",
  // The documents and their reading, for this section and its modal (D15).
  providers: [Documents],
  host: {
    class: "flex min-h-0 flex-1 flex-col overflow-hidden",
    "(document:pointerdown)": "pressedAnywhere($event)",
    "(document:click)": "pressEnded()",
    "(document:keydown.escape)": "escaped()",
  },
})
export class ProfileViewer {
  private readonly router = inject(Router);

  private readonly documents = inject(Documents);

  protected readonly profile = signal<Answer | null>(null);

  /** Whether the drop zone is open over the profile (`ID160`). */
  protected readonly adding = signal(false);

  /** The last region pressed by hand, which is what opens a tool on it (`US8`). */
  protected readonly selected = signal<RegionRef | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>("scroller");

  /** The column the reveal last followed, whose observer and listeners go with this section. */
  private followed: HTMLElement | null = null;

  /**
   * Where a press landed, resolved against the profile: an item is itself, and a line is
   * the item it belongs to with the line's own id beside it. `null` when they pressed
   * nothing, or nothing of their profile.
   */
  private readonly on = computed<Held | null>(() => {
    const region = this.selected();
    if (region === null) return null;
    return region.kind === "line" ? this.lineOf(region.id) : this.itemOf(region.id);
  });

  /** Which region the sheet lifts: the one pressed, line or item, and nothing otherwise. */
  protected readonly lifted = computed(() => {
    const on = this.on();
    return on === null ? null : (on.lineId ?? on.itemId);
  });

  protected readonly focused = computed(() => this.lifted() !== null);

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

  /**
   * `Read 14 September`: the day the documents were read, and nothing else
   * (product-flow-rework `H10`, `ID331`). A count of documents is bookkeeping, and the
   * bar stopped doing any.
   */
  protected readonly readLine = computed(() => {
    const profile = this.profile();
    // `readOn` is the guard as well as the date: it is null until a reading has read
    // something, and the count that used to stand here went with `provenance` (`ID334`).
    if (profile === null || profile.readOn === null) return "";
    return `Read ${this.when(profile.readOn)}`;
  });

  protected readonly name = computed(() => this.profile()?.name ?? "");

  constructor() {
    void this.load();

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
      // Nothing is held: the column stays exactly where the person left it (`S5.4`).
      if (lifted === null) return;
      const region = column.querySelector<HTMLElement>(`[data-id="${lifted}"]`);
      if (region !== null) revealInColumn(column, region);
    });

    /** The observer and the two listeners the reveal set up go with the section (`ID248`). */
    inject(DestroyRef).onDestroy(() => {
      if (this.followed !== null) stopFollowing(this.followed);
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

  /**
   * `14 September`: the day itself, read from the answer and never counted from it. The
   * year is said only when it is not this one, so the bar's line stays the mockup's
   * ("Read 14 September") for every profile anybody has and is still unambiguous for one
   * read years ago.
   */
  private when(readOn: string | null): string {
    const read = readOn === null ? new Date() : new Date(readOn);
    const thisYear = read.getFullYear() === new Date().getFullYear();
    return read.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      ...(thisYear ? {} : { year: "numeric" }),
    });
  }

  /**
   * A region pressed by hand, item or line. A line lights on hover, so it is held on a
   * press as well (the person, 2026-09-13), and a line is held on the item it belongs to,
   * since what hangs from a region hangs from an item and never from a line.
   */
  protected chosen(region: RegionRef): void {
    // The click of a press that has just let a region go holds nothing (`ID236`).
    if (this.swallowing) {
      this.swallowing = false;
      return;
    }
    this.selected.set(region);
  }

  /**
   * Whether the press under way let a region go on its way down, so that its click, which
   * a region stops from travelling further, holds nothing where it landed (`ID236`).
   */
  private swallowing = false;

  /**
   * A press anywhere on the page while a region is held lets it go (agent-consolidation
   * `S8.8`, `ID236`), unless it lands on the held region itself. Read on the pointer going
   * down, before the click.
   */
  protected pressedAnywhere(event: Event): void {
    this.swallowing = false;
    if (this.selected() === null) return;
    const target = event.target;
    if (target instanceof Element) {
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

  /** Escape lets the held region go, as a press away does (`ID236`). */
  protected escaped(): void {
    if (this.selected() !== null) this.overlayPressed();
  }

  /**
   * A press away lets go of what is held, and decides nothing (the person, 2026-09-13 and
   * 2026-09-14). The sheet undims and the column stays where the person left it.
   */
  protected overlayPressed(): void {
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

  /** An item, by its id, and nothing when the id is not one of this profile's. */
  private itemOf(id: string): Held | null {
    const item = this.items().find((each) => each.id === id);
    return item === undefined ? null : { itemId: item.id, lineId: null };
  }

  /** A line, by its id: the item it belongs to, with the line beside it. */
  private lineOf(id: string): Held | null {
    for (const item of this.items()) {
      if (item.lines.some((each) => each.id === id)) return { itemId: item.id, lineId: id };
    }
    return null;
  }

  /**
   * Where an application starts (`ID332`): the door itself is `offer-intake`'s and does
   * not exist yet, so the button leads to the index, which draws that door and says in
   * one place that it is not open. Two doors, one message.
   */
  protected startApplication(): void {
    void this.router.navigateByUrl("/");
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
