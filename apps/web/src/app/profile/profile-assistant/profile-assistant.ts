import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { Assistant } from "../../assistant/assistant/assistant";
import { guide } from "../../guide/guide";
import { atOnce, GUIDE_PACE } from "../../guide/pace";
import { doThis, say, show, shownOf } from "../../guide/say";
import { UiText } from "../../ui/typography/text/text";
import { ProgressLine } from "../progress-line/progress-line";
import { ReadingCard } from "../reading-card/reading-card";
import type { OpenQuestion, OpenTool, Option } from "../scope-tool/scope-tool";
import { ScopeTool } from "../scope-tool/scope-tool";

/**
 * The assistant's column, for the intake (`S4.2`, `S4.4`, `S5.1`, `S5.2`, the mockup's
 * `ProfileAssistant`).
 *
 * **It composes the core assistant rather than being it** (`S7.4`, the person's own
 * words: *"Profile assistant is a concrete implementation of core assistant and
 * stays"*). `app/assistant/` draws the column, the dock, the prefix and the bar and
 * holds no word of any use case; everything the intake says is here — the opener, the
 * welcome, the reading card's sentences, the tool that opens, and `Scope`, which is the
 * word this use case names the thing in the prefix with.
 *
 * **The first waiting question opens with no click at all.** In every state the
 * assistant asks the first one still waiting; the person skips or cancels and never
 * hunts for it. There is no done state: when nothing is left the dock closes, the
 * assistant says so, and the sheet stays.
 *
 * **A region the person pressed takes precedence over the order** (`US8`). If a question
 * is waiting on that very region, that is the question the assistant opens; if none is,
 * the tool opens in the shape that proposes nothing and what is written becomes that
 * item's rule. Which of the two it is, this class decides and the tool renders.
 *
 * **Returning is not the end of a run** (`US9`). Days later the assistant greets the
 * person and asks the first question still waiting: the finished run's opener is not
 * replayed, and there is no done state and no exit anywhere on this screen.
 *
 * The class holds the questions as an input and exposes computeds; the template binds
 * signals and reaches no service (`AGENTS.md` 3). What an answer *does* is the viewer's,
 * which owns the client — so what leaves here is which question was answered and with
 * what, which was skipped, and which item a clarification was written on.
 */

/** One question as the interface answers it, which is what this column is given. */
export type Question = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: string;
  where: string;
  lead: string;
  state: string;
  options: { id: string; label: string; hint: string; rule: string | null }[];
};

/**
 * The region the person pressed: which item it is, and **where** it is — a name for an
 * item, and `the post · row 3` for a line. Never the line's own sentence: the sheet has
 * already lifted it, and saying it again in the tool is the same thing twice (the
 * person, 2026-09-13).
 *
 * A line carries the item it belongs to and its own id beside it, because what is
 * written about a line is kept on that item.
 */
export type Pressed = { itemId: string; where: string; lineId: string | null };

/** The word the intake names the thing in the prefix with. The builder will have its own. */
const scope = "Adjusting scope";

/**
 * What that word means, said on hover. The intake's own sentence: the chip is two words
 * and a person meeting it for the first time deserves the rest of it somewhere (the
 * person, 2026-09-13).
 */
const whatScopeMeans =
  "What you say next is kept as your rule about this item. Nothing is sent to anyone, and every CV respects it.";

/** One thing the assistant has said, in the order it said it. */
type Said = { kind: "ai"; text: string } | { kind: "ok"; text: string };

@Component({
  selector: "profile-assistant",
  imports: [Assistant, ProgressLine, ReadingCard, ScopeTool, UiText],
  templateUrl: "./profile-assistant.html",
  host: { class: "flex min-h-0 min-w-0 flex-1 flex-col" },
})
export class ProfileAssistant {
  public readonly questions = input<Question[]>([]);

  /** The region the person pressed themselves, if any. Nothing is pressed to begin with. */
  public readonly on = input<Pressed | null>(null);

  /**
   * Whether the person put the tool down by pressing the dimmed profile (the person,
   * 2026-09-13). Nothing is written and nothing is decided; the question is still
   * waiting and opens again the moment they press a region.
   */
  public readonly dismissed = input<boolean>(false);

  /** Whether this is a visit after the reading rather than the run that produced it. */
  public readonly returning = input<boolean>(false);

  /** What the reading produced: the documents read, and the facts it can honestly count. */
  public readonly reading = input<{ documents: number; facts: number }>({
    documents: 0,
    facts: 0,
  });

  /** The opening's first sentence, and how much of it has landed. */
  protected readonly opening = computed(
    () =>
      `I read your ${this.readLine()}. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.`,
  );

  protected readonly openingShown = computed(() => shownOf(this.opening(), this.told()));

  /** The sentence after the card, and how much of it has landed. */
  protected readonly tail =
    "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.";

  protected readonly tailShown = computed(() => shownOf(this.tail, this.toldTail()));

  /** The opener — `First, Java.` — and how much of it has landed. */
  protected readonly openerShown = computed(() => shownOf(this.opener(), this.spoken()));

  /** `1 document` or `4 documents`: a count a person reads, not a count with an `s`. */
  protected readonly readLine = computed(() => {
    const documents = this.reading().documents;
    return `${documents} document${documents === 1 ? "" : "s"}`;
  });

  public readonly answered = output<{ questionId: string; optionId?: string; words?: string }>();

  public readonly skipped = output<{ questionId: string }>();

  /** What the person said about an item nobody asked about (`US8`), or one of its lines. */
  public readonly clarified = output<{ itemId: string; words: string; lineId?: string }>();

  /** The person-opened tool, closed with nothing written. */
  public readonly cancelled = output<void>();

  private readonly assistant = viewChild(Assistant);

  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly pace = inject(GUIDE_PACE);

  /**
   * How much of the opening has landed (`2026-09-13-guided-effects.spec.md`).
   *
   * The column starts empty and fills the way an answer does: the first sentence a word
   * at a time, the reading card as one beat (`G5`), the second sentence, and only then
   * the tool. A person arriving learns that this column is a conversation by watching it
   * be one — which no sentence explaining it would achieve.
   *
   * `told` counts the words of whichever message is landing; the template shows that
   * many. `card` and `spoken` are the beats that are not prose.
   */
  protected readonly told = signal(0);

  protected readonly toldTail = signal(0);

  protected readonly card = signal(false);

  protected readonly spoken = signal(0);

  /** Whether the sequence has let the tool open yet (`G3`: it is a step, not state). */
  protected readonly toolLetOpen = signal(false);

  /** Which row of the open question the person has picked, if any. */
  protected readonly picked = signal<string | null>(null);

  protected readonly total = computed(() => this.questions().length);

  protected readonly answeredCount = computed(
    () => this.questions().filter((question) => question.state === "answered").length,
  );

  /** What the person put off, which is what the count calls "for the builder" (`US7`). */
  protected readonly deferred = computed(
    () => this.questions().filter((question) => question.state === "skipped").length,
  );

  protected readonly waiting = computed(() =>
    this.questions().filter((question) => question.state === "waiting"),
  );

  protected readonly left = computed(() => this.waiting().length);

  /**
   * The questions nobody has answered yet, skipped ones included. A skipped question
   * still marks its item `scope to clarify`, so the item still requires clarification and a
   * press on it reopens the question with its rows rather than the tool that proposes
   * nothing (the person, 2026-09-13). The assistant's own order is over `waiting` alone:
   * a skipped question is put off until the builder, never asked again unprompted.
   */
  private readonly stillOpen = computed(() =>
    this.questions().filter((question) => question.state !== "answered"),
  );

  /**
   * The question the assistant has open: the one still open on the item the person
   * pressed, or the first one waiting when they pressed nothing (`S4.2`). A line has no
   * question of its own, so a press on one never opens its item's.
   */
  protected readonly open = computed(() => {
    const pressed = this.on();
    if (pressed === null) return this.waiting()[0] ?? null;
    if (pressed.lineId !== null) return null;
    return this.stillOpen().find((question) => question.itemId === pressed.itemId) ?? null;
  });

  /** The region the person pressed and no question is waiting on: their own tool. */
  protected readonly clarifying = computed(() => {
    const pressed = this.on();
    return pressed === null || this.open() !== null ? null : pressed;
  });

  /**
   * `First, Kubernetes.` the first time, `Next, <the name>.` afterwards. "Afterwards" is
   * a question of this run having moved on, which is exactly what an answered or a
   * skipped question is. A tool the person opened themselves has no opener at all.
   */
  protected readonly opener = computed(() => {
    const question = this.open();
    if (question === null) return "";
    const moved = this.answeredCount() + this.deferred() > 0;
    return `${moved ? "Next" : "First"}, ${question.itemTitle}.`;
  });

  /**
   * The greeting a second visit opens on, in place of the run's own opener (`US9`, the
   * mockup's returning variant). The run that produced this profile is not replayed: what
   * a person coming back needs is what is still waiting.
   */
  protected readonly welcome = computed(() => {
    if (!this.returning()) return "";
    const things = this.left();
    return `Welcome back. ${things} thing${things === 1 ? "" : "s"} I still could not tell from your documents.`;
  });

  /** The question in the shape the tool takes it, four answers at most by the type. */
  private readonly question = computed<OpenQuestion | null>(() => {
    const question = this.open();
    if (question === null) return null;
    const [first, second, third, fourth] = question.options as [Option?, Option?, Option?, Option?];
    if (first === undefined) return null;
    const options =
      fourth !== undefined && third !== undefined && second !== undefined
        ? ([first, second, third, fourth] as const)
        : third !== undefined && second !== undefined
          ? ([first, second, third] as const)
          : second !== undefined
            ? ([first, second] as const)
            : ([first] as const);
    return { kind: "asked", where: question.where, lead: question.lead, options };
  });

  /**
   * What is open in the dock. A clarification carries where the person is and no option,
   * which is what makes the shape that proposes nothing unable to propose.
   */
  protected readonly asked = computed<OpenTool | null>(() => {
    const pressed = this.clarifying();
    if (pressed !== null) return { kind: "clarification", where: pressed.where };
    // Put down by a press on the dimmed profile, and staying down until a region is
    // pressed again.
    if (this.dismissed()) return null;
    // The sequence opens the first question as a step of its own (`G3`). A tool the
    // person asked for by pressing a region never waits for anybody.
    return this.toolLetOpen() ? this.question() : null;
  });

  /**
   * What the prefix says, and what hovering it explains: this use case's own word and
   * its own sentence, supplied here and nowhere in core — which is what "concrete tool
   * prefixes per use case" means. Nothing a document wrote appears in either.
   *
   * **Where a person is travels with it** (the person, 2026-09-14): the path — an item's
   * name, or a post and a row — is the composer's to show, between the tool and the bar
   * while the bar is one line and inside the bar once it is many. It moved out of the
   * tool so that it sits beside what is being written about it.
   */
  protected readonly tool = computed(() => {
    const pressed = this.clarifying();
    if (pressed !== null) return { label: scope, describes: whatScopeMeans, where: pressed.where };
    const question = this.open();
    return question === null
      ? null
      : { label: scope, describes: whatScopeMeans, where: question.where };
  });

  /** The count under the reading card: what is left for the person to say. */
  protected readonly stream = computed<Said[]>(() => {
    if (this.open() !== null || this.clarifying() !== null) return [];
    return [
      { kind: "ok", text: "That is all I needed." },
      {
        kind: "ai",
        text: "Your profile is ready. Start an application, or click anything on the right to correct it.",
      },
    ];
  });

  constructor() {
    /**
     * The intake's own guided sequence, run on the screen's **first render** (`G3`).
     *
     * Every visit, not once per person, and not again while they stay: answering a
     * question does not replay the opener; leaving and coming back does. The steps are
     * this use case's words and this use case's tool — `app/guide/` holds none of them.
     *
     * A person who types, clicks or scrolls abandons the performance and keeps
     * everything: the words whole, the card shown, the tool open (`G2`).
     */
    afterNextRender(() => {
      /**
       * **Only a brand new chat is performed** (the person, 2026-09-13).
       *
       * The opening is written for somebody seeing this column for the first time in
       * this visit. A conversation that already has something in it — a person coming
       * back, a question already answered or put off — is a conversation being resumed,
       * and typing its first line out again would be the interface pretending to think
       * about something it has already said. Everything lands at once instead, and the
       * tool still opens.
       */
      const pace = this.reduced() || !this.brandNew() ? atOnce : this.pace;
      guide(
        [
          say("opening", this.opening(), this.told, pace),
          show("card", this.card, pace),
          say("tail", this.tail, this.toldTail, pace),
          doThis("tool", () => this.toolLetOpen.set(true), pace),
          say("opener", this.opener(), this.spoken, pace),
        ],
        this.host.nativeElement as HTMLElement,
      );
    });
  }

  /**
   * Whether this column has nothing in it yet: nothing said after the opening, nobody
   * returning, no question answered or put off. Only then is the opening performed.
   */
  private brandNew(): boolean {
    return (
      !this.returning() &&
      this.stream().length === 0 &&
      this.answeredCount() + this.deferred() === 0
    );
  }

  /** What a person asked for when they asked for less motion (`G6`). */
  private reduced(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  protected pick(chosen: { optionId: string }): void {
    this.picked.set(chosen.optionId);
  }

  /**
   * Save: the row that was picked, the words that were typed, or both (`US6`) — or, in
   * the tool the person opened themselves, the words alone, which become that item's
   * rule and nothing else (`US8`).
   */
  protected save(): void {
    const words = this.assistant()?.draft().trim() ?? "";
    const pressed = this.clarifying();
    if (pressed !== null) {
      if (words === "") return;
      this.clarified.emit({
        itemId: pressed.itemId,
        words,
        ...(pressed.lineId === null ? {} : { lineId: pressed.lineId }),
      });
      this.forget();
      return;
    }
    const question = this.open();
    if (question === null) return;
    const optionId = this.picked();
    if (optionId === null && words === "") return;
    this.answered.emit({
      questionId: question.id,
      ...(optionId === null ? {} : { optionId }),
      ...(words === "" ? {} : { words }),
    });
    this.forget();
  }

  /**
   * Skip, and the prefix's × while a question waits, which the handoff note makes the
   * same gesture: the current question is put off and the next one opens. The dock
   * closes only when nothing is left. On the tool the person opened themselves the same
   * gesture is Cancel, and it writes nothing.
   */
  protected skip(): void {
    if (this.clarifying() !== null) {
      this.cancelled.emit();
      this.forget();
      return;
    }
    const question = this.open();
    if (question === null) return;
    this.skipped.emit({ questionId: question.id });
    this.forget();
  }

  private forget(): void {
    this.picked.set(null);
    this.assistant()?.clearDraft();
  }
}
