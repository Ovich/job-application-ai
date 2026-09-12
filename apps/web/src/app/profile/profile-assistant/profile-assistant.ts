import { Component, computed, input, output, signal, viewChild } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";
import { Composer } from "../composer/composer";
import { ProgressLine } from "../progress-line/progress-line";
import { ReadingCard } from "../reading-card/reading-card";
import type { OpenQuestion, Option } from "../scope-tool/scope-tool";
import { ScopeTool } from "../scope-tool/scope-tool";

/**
 * The assistant's column (`S4.2`, `S4.4`, the mockup's `ProfileAssistant`).
 *
 * **The first waiting question opens with no click at all.** In every state the
 * assistant asks the first one still waiting; the person skips or cancels and never
 * hunts for it. There is no done state: when nothing is left the dock closes, the
 * assistant says so, and the sheet stays.
 *
 * The class holds the questions as an input and exposes computeds; the template binds
 * signals and reaches no service (`AGENTS.md` 3). What an answer *does* is the viewer's,
 * which owns the client — so what leaves here is which question was answered and with
 * what, and which was skipped.
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

/** One thing the assistant has said, in the order it said it. */
type Said = { kind: "ai"; text: string } | { kind: "ok"; text: string };

@Component({
  selector: "profile-assistant",
  imports: [Composer, ProgressLine, ReadingCard, ScopeTool, UiText],
  templateUrl: "./profile-assistant.html",
  host: { class: "flex min-h-0 min-w-0 flex-col" },
})
export class ProfileAssistant {
  public readonly questions = input<Question[]>([]);

  /** What the reading produced: the documents read, and the facts it can honestly count. */
  public readonly reading = input<{ documents: number; facts: number }>({
    documents: 0,
    facts: 0,
  });

  public readonly answered = output<{ questionId: string; optionId?: string; words?: string }>();

  public readonly skipped = output<{ questionId: string }>();

  private readonly composer = viewChild(Composer);

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

  protected readonly left = computed(
    () => this.questions().filter((question) => question.state === "waiting").length,
  );

  /** The first question still waiting. Nothing is clicked to open it (`S4.2`). */
  protected readonly open = computed(
    () => this.questions().find((question) => question.state === "waiting") ?? null,
  );

  /**
   * `First, Kubernetes.` the first time, `Next, <the name>.` afterwards. "Afterwards" is
   * a question of this run having moved on, which is exactly what an answered or a
   * skipped question is.
   */
  protected readonly opener = computed(() => {
    const question = this.open();
    if (question === null) return "";
    const moved = this.answeredCount() + this.deferred() > 0;
    return `${moved ? "Next" : "First"}, ${question.itemTitle}.`;
  });

  /** The question in the shape the tool takes it, four answers at most by the type. */
  protected readonly asked = computed<OpenQuestion | null>(() => {
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
    return { where: question.where, lead: question.lead, options };
  });

  protected readonly tool = computed(() => {
    const question = this.open();
    return question === null ? null : { what: question.itemTitle };
  });

  /** The count under the reading card: what is left for the person to say. */
  protected readonly stream = computed<Said[]>(() => {
    if (this.open() !== null) return [];
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

  /** Save: the row that was picked, the words that were typed, or both (`US6`). */
  protected save(): void {
    const question = this.open();
    if (question === null) return;
    const optionId = this.picked();
    const words = this.composer()?.draft().trim() ?? "";
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
   * closes only when nothing is left.
   */
  protected skip(): void {
    const question = this.open();
    if (question === null) return;
    this.skipped.emit({ questionId: question.id });
    this.forget();
  }

  private forget(): void {
    this.picked.set(null);
    this.composer()?.clearDraft();
  }
}
