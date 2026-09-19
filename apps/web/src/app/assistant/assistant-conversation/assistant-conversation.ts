import { NgTemplateOutlet } from "@angular/common";
import {
  afterEveryRender,
  Component,
  computed,
  contentChild,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  type TemplateRef,
} from "@angular/core";
import { CurrentUser } from "../../auth/current-user";
import { initialsOf } from "../../auth/session";
import { ago, exactly } from "../../lib/ago";
import { UiText } from "../../ui/typography/text/text";
import { Assistant } from "../assistant/assistant";
import { AssistantCore } from "../assistant-core";
import type { Entry } from "../entry";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/**
 * What the column held at its last render: the stored entries, the length of the words in
 * its messages, the length of all its words, and the active tool.
 */
type Held = { entries: number; words: number; text: number; on: string | null };

/** The length of an element's words, less the phrases of when things were written. */
const lengthOf = (element: Element): number => {
  let length = element.textContent?.length ?? 0;
  for (const time of Array.from(element.querySelectorAll("time"))) {
    length -= time.textContent?.length ?? 0;
  }
  return length;
};

/**
 * The words in the column's messages, the streaming reply and the activity aside, as those
 * never took the column back to its end; and the length of everything it shows.
 */
const wordsIn = (column: HTMLElement): { words: number; text: number } => {
  let words = 0;
  for (const message of Array.from(column.querySelectorAll("[data-msg]"))) {
    if (message.querySelector("[data-part=replying], [data-part=activity]") === null) {
      words += lengthOf(message);
    }
  }
  return { words, text: lengthOf(column) };
};

/**
 * The conversation the screen's `AssistantCore` holds, drawn (`ID175`, the spec's
 * *Drawing it*).
 *
 * It draws `text` itself and hands every other part to the `#part` template the concrete
 * assistant gives (D4). **With no `#part` given, such a part is drawn as a placeholder and
 * never dropped** (the spec's *Failure modes*): an entry written by a later catalogue still
 * takes its place in the conversation.
 *
 * **The concrete assistant may draw its own opening.** A `<ng-template #firstEntry>` given
 * as content is what entry 1 is drawn with, so the intake keeps the reading card between the
 * opening's sentences, which is drawn from the profile and not stored (`ID200`), and the
 * opening is still drawn once, in its place. With none given, entry 1 is drawn like
 * every other.
 *
 * **Who wrote an entry is where it sits** (`S4.7`, spec `H26`): what the assistant writes,
 * its streaming reply and its records included, takes the column's full width behind its
 * avatar; what the person writes, and the parts of their own tool use, sits on the right at
 * most 70% wide, the components library's `.me` bubble, behind their initials; a `system`
 * entry's notice is one quiet line with no avatar (D34), which nothing answers.
 *
 * **It keeps its own column at its end** (D6, `ID227`, `ID237`): the newest line in view
 * above the dock, until the person scrolls or presses in it.
 *
 * No inputs and no outputs: it reads the core, the person signed in and the templates it is
 * given, and holds no call of its own.
 */
@Component({
  selector: "assistant-conversation",
  imports: [NgTemplateOutlet, UiText],
  templateUrl: "./assistant-conversation.html",
  host: { class: "flex flex-col gap-5" },
})
export class AssistantConversation {
  private readonly core = inject(AssistantCore);

  private readonly currentUser = inject(CurrentUser);

  protected readonly entries = this.core.entries;

  /** The reply streaming now, drawn as a stored reply is drawn once it has landed. */
  protected readonly replying = this.core.replying;

  /** What went wrong, in one sentence. */
  protected readonly failure = this.core.failure;

  /** What the agent is doing now, drawn beside an animated indicator until its words land. */
  protected readonly activity = this.core.activity;

  /** The concrete assistant's own drawing of entry 1, `#firstEntry`, when it gives one. */
  protected readonly opening = contentChild<TemplateRef<unknown>>("firstEntry");

  /**
   * What the concrete assistant draws after an entry, `#afterEntry`, given the entry's
   * position from 1: the lines it said once that entry was stored and never stored
   * themselves (agent-consolidation `ID227`), so they read in order for the visit.
   */
  protected readonly afterEntry = contentChild<TemplateRef<unknown>>("afterEntry");

  /** How the concrete assistant draws a part that is not text, `#part`, given the part (D4). */
  protected readonly drawPart = contentChild<TemplateRef<unknown>>("part");

  /**
   * The person's avatar on what they write (`S4.7`): their initials, as the account button
   * shows them.
   */
  protected readonly initials = computed(() => initialsOf(this.currentUser.person()?.name ?? ""));

  /**
   * The time the phrases are said from, read again once a minute while the conversation
   * is on the screen (`ID220`), so `just now` becomes `1 min ago` with no reload.
   */
  private readonly now = signal(new Date());

  /** What the column held at its last render. */
  private held: Held = { entries: 0, words: 0, text: 0, on: null };

  /** The column kept at its end, and whether the person has taken it over since. */
  private keeping: { column: HTMLElement; touched: boolean; stop: () => void } | null = null;

  /** What watches the kept column's size and the size of what it holds. */
  private observing: ResizeObserver | null = null;

  constructor() {
    const every = setInterval(() => this.now.set(new Date()), 60 * 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(every);
      this.keeping?.stop();
    });

    /**
     * The newest line in view above the dock (`ID227`): after each render that lands a
     * word, stores an entry or activates a tool, the column that scrolls the conversation
     * is taken to its end. The dock sits below that column, so its end is above the dock.
     *
     * **And kept there while the column settles** (`ID237`). A render is not the last word
     * on the column's size: below 1024 px the column is drawn hidden behind the sheet and
     * gets its height only when the chat is shown, and content can grow after the render
     * that drew it. No signal says either, so the end is kept on the column's resizes too,
     * until the person scrolls or presses in it.
     *
     * The words the concrete assistant performs are its own signals, so what landed is read
     * from the column after each render, and nothing is done on a render that changed none of it.
     */
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const assistant = inject(Assistant, { optional: true });
    afterEveryRender(() => {
      // The column is what the core assistant scrolls the conversation in: its own child
      // holding this conversation, found by where it sits rather than by a computed style.
      const column = host.closest<HTMLElement>("assistant > *");
      if (column === null) return;
      const tool = assistant?.tool() ?? null;
      const now: Held = {
        entries: this.core.entries().length,
        ...wordsIn(column),
        on: tool === null ? null : `${tool.label} ${tool.where}`,
      };
      const was = this.held;
      const same =
        now.entries === was.entries &&
        now.words === was.words &&
        now.text === was.text &&
        now.on === was.on;
      if (same && this.keeping?.column === column) return;
      const news =
        now.words > was.words ||
        now.entries > was.entries ||
        (now.on !== null && now.on !== was.on);
      this.held = now;
      this.keepAtEnd(column, news);
    });
  }

  /**
   * That column at its end, and kept there on each resize of it or of what it holds until
   * the person scrolls or presses in it (`ID237`). Something new, a word, an entry or a
   * tool activated, takes it back to its end and keeps it again (`ID227`); a render with
   * nothing new, a tool closed by that very press, leaves the person's column alone.
   */
  private keepAtEnd(column: HTMLElement, news: boolean): void {
    if (this.keeping?.column !== column) {
      this.keeping?.stop();
      const uses = ["wheel", "touchmove", "pointerdown"] as const;
      const touched = (): void => {
        if (this.keeping !== null) this.keeping.touched = true;
      };
      for (const use of uses) column.addEventListener(use, touched, { passive: true });
      // A runtime with no `ResizeObserver` has no settling to follow, the trade
      // `profile/reveal` makes too.
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => {
              if (this.keeping?.touched === false) column.scrollTop = column.scrollHeight;
            });
      this.keeping = {
        column,
        touched: false,
        stop: () => {
          observer?.disconnect();
          for (const use of uses) column.removeEventListener(use, touched);
        },
      };
      this.observing = observer;
      news = true;
    }
    if (news) this.keeping.touched = false;
    if (!this.keeping.touched) column.scrollTop = column.scrollHeight;
    this.observing?.observe(column);
    for (const child of Array.from(column.children)) this.observing?.observe(child);
  }

  /** When an entry was stored, as a phrase: `5 min ago`. */
  protected when(createdAt: string): string {
    return ago(new Date(createdAt), this.now());
  }

  /** When an entry was stored, in full, for the hover. */
  protected exactlyWhen(createdAt: string): string {
    return exactly(new Date(createdAt));
  }

  /** The words of a `text` or a `notice` part. */
  protected textOf(part: Part): string {
    return "text" in part && typeof part.text === "string" ? part.text : "";
  }
}
