import {
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
import { api } from "../../lib/api";
import { UiSpinner } from "../../ui/spinner/spinner";
import { UiText } from "../../ui/typography/text/text";
import { ProfileAssistant } from "../profile-assistant/profile-assistant";
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

@Component({
  selector: "profile-viewer",
  imports: [ProfileAssistant, ProfileBar, ProfileSheet, UiSpinner, UiText],
  templateUrl: "./profile-viewer.html",
})
export class ProfileViewer {
  private readonly router = inject(Router);

  protected readonly profile = signal<Answer | null>(null);

  /** Which column is showing below 1024 px. The profile is what a person came for. */
  protected readonly view = signal<"sheet" | "chat">("sheet");

  /** The last region pressed by hand, which is what opens a tool on it (`US8`). */
  protected readonly selected = signal<RegionRef | null>(null);

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

  /**
   * The question the assistant has open: the one waiting on the region the person
   * pressed, or the first one still waiting. The assistant decides the same way from the
   * same two inputs; this is what the sheet is placed by.
   */
  private readonly open = computed(() => {
    const region = this.selected();
    if (region === null) return this.waiting()[0] ?? null;
    return this.waiting().find((question) => question.itemId === region.id) ?? null;
  });

  /**
   * The region the person pressed, in its own text, for the tool's prefix. `null` when
   * they pressed nothing, or pressed something that is not an item of their profile.
   */
  protected readonly pressed = computed(() => {
    const region = this.selected();
    if (region === null) return null;
    const title = this.titleOf(region.id);
    return title === null ? null : { itemId: region.id, title };
  });

  /**
   * Which region the sheet lifts: the region the person pressed themselves, or the open
   * question's item. Nothing is lifted when no tool is open.
   */
  protected readonly lifted = computed(() => this.pressed()?.itemId ?? this.open()?.itemId ?? null);

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
      "min-h-0 min-w-0 border-border bg-card max-lg:order-2 lg:block lg:border-r",
      this.view() === "chat" ? "block" : "hidden",
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
     * The reveal, redone whenever the lifted region changes. It is an effect and not a
     * handler because the region is a computed over the profile the interface answered:
     * a run that ends, a question that is skipped and a reload all move it, and each of
     * them should place the column the same way.
     */
    effect((onCleanup) => {
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
      onCleanup(() => {});
    });
  }

  private async load(): Promise<void> {
    const answer = await api.intake.profile.$get();
    if (answer.ok) this.profile.set(await answer.json());
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
   * A region pressed by hand. An item is what a rule can be written on and what a
   * question hangs from, so a press on a line opens nothing: the tool that edits one is
   * the builder's, and it is not this slice's (the slice's `F4`).
   */
  protected chosen(region: RegionRef): void {
    if (region.kind === "item") this.selected.set(region);
  }

  /** The overlay's press is the prefix's ×, which while a question waits is a skip. */
  protected overlayPressed(): void {
    if (this.pressed() !== null && this.open() === null) {
      this.cancelled();
      return;
    }
    const question = this.open();
    if (question !== null) void this.skipped({ questionId: question.id });
  }

  /**
   * What the person wrote about an item nobody asked about, kept as that item's rule
   * (`US8`), and the profile read back so the check line shown is the one the database
   * agrees with. The sheet is left where they opened it: this ending is not the run's.
   */
  protected async clarified(said: { itemId: string; words: string }): Promise<void> {
    this.viaQuestion = false;
    await api.intake.items[":id"].rule.$post({
      param: { id: said.itemId },
      json: { words: said.words },
    });
    this.selected.set(null);
    await this.load();
  }

  /** The person-opened tool, closed with nothing written and nothing moved. */
  protected cancelled(): void {
    this.viaQuestion = false;
    this.selected.set(null);
  }

  /** An item's own text, by its id, wherever it hangs in the profile. */
  private titleOf(id: string): string | null {
    const profile = this.profile();
    if (profile === null) return null;
    const find = (items: { id: string; title: string; children: unknown[] }[]): string | null => {
      for (const item of items) {
        if (item.id === id) return item.title;
        const under = find(item.children as typeof items);
        if (under !== null) return under;
      }
      return null;
    };
    return find([
      ...(profile.summary === null ? [] : [profile.summary]),
      ...(profile.identity === null ? [] : [profile.identity]),
      ...profile.experience,
      ...profile.projects,
      ...profile.groups,
      ...profile.education,
    ]);
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
    await this.load();
  }

  protected async skipped(said: { questionId: string }): Promise<void> {
    this.viaQuestion = true;
    this.selected.set(null);
    await api.intake.questions[":id"].answer.$post({
      param: { id: said.questionId },
      json: { skip: true },
    });
    await this.load();
  }

  /** The way back to the drop zone, which is what an empty profile needs most. */
  protected addDocuments(): Promise<boolean> {
    return this.router.navigateByUrl("/documents");
  }

  /** The observer and the two listeners the reveal set up go with the column. */
  protected stopWatching(): void {
    const column = this.scroller()?.nativeElement;
    if (column !== undefined) stopFollowing(column);
  }
}
