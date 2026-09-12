import { Component, computed, input, output, signal, viewChild } from "@angular/core";
import { Assistant } from "../../assistant/assistant/assistant";
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

/** The region the person pressed, in its own words: the item, and its own text. */
export type Pressed = { itemId: string; title: string };

/** The word the intake names the thing in the prefix with. The builder will have its own. */
const scope = "Scope";

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

  /** Whether this is a visit after the reading rather than the run that produced it. */
  public readonly returning = input<boolean>(false);

  /** What the reading produced: the documents read, and the facts it can honestly count. */
  public readonly reading = input<{ documents: number; facts: number }>({
    documents: 0,
    facts: 0,
  });

  /** `1 document` or `4 documents`: a count a person reads, not a count with an `s`. */
  protected readonly readLine = computed(() => {
    const documents = this.reading().documents;
    return `${documents} document${documents === 1 ? "" : "s"}`;
  });

  public readonly answered = output<{ questionId: string; optionId?: string; words?: string }>();

  public readonly skipped = output<{ questionId: string }>();

  /** What the person said about an item nobody asked about (`US8`). */
  public readonly clarified = output<{ itemId: string; words: string }>();

  /** The person-opened tool, closed with nothing written. */
  public readonly cancelled = output<void>();

  private readonly assistant = viewChild(Assistant);

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
   * The question the assistant has open: the one waiting on the region the person
   * pressed, or the first one still waiting when they pressed nothing (`S4.2`).
   */
  protected readonly open = computed(() => {
    const pressed = this.on();
    if (pressed === null) return this.waiting()[0] ?? null;
    return this.waiting().find((question) => question.itemId === pressed.itemId) ?? null;
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
   * What is open in the dock. A clarification carries what it is about and no option,
   * which is what makes the shape that proposes nothing unable to propose.
   */
  protected readonly asked = computed<OpenTool | null>(() => {
    const pressed = this.clarifying();
    return pressed === null ? this.question() : { kind: "clarification", about: pressed.title };
  });

  /**
   * What the prefix says: this use case's own word, and nothing a document wrote. The
   * word is supplied here and nowhere in core, which is what "concrete tool prefixes per
   * use case" means; `what` stays in the contract as the thing the chip is about, for a
   * use case whose relation needs saying, and the intake's chip renders the word alone.
   */
  protected readonly tool = computed(() => {
    const pressed = this.clarifying();
    if (pressed !== null) return { label: scope, what: pressed.title };
    const question = this.open();
    return question === null ? null : { label: scope, what: question.itemTitle };
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
      this.clarified.emit({ itemId: pressed.itemId, words });
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
