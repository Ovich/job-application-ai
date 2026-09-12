import { Component, computed, input } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * The count above the assistant's stream (the mockup's `ProgressLine`).
 *
 * **The count is a count.** `0 of 3 answered`, and `, 1 for the builder` when a question
 * was skipped. Never a percentage, in the text or in an `aria` value: the handoff note
 * says so in as many words, and the bar beside it is decoration.
 *
 * It renders what comes in and owns nothing.
 */
@Component({
  selector: "progress-line",
  imports: [UiText],
  templateUrl: "./progress-line.html",
  host: {
    class: "flex h-16 flex-none items-center gap-3.5 border-border border-b px-6",
  },
})
export class ProgressLine {
  public readonly answered = input<number>(0);

  public readonly total = input<number>(0);

  /** How many the person put off, which is what the builder picks up (`US7`). */
  public readonly deferred = input<number>(0);

  protected readonly count = computed(() => {
    const said = `${this.answered()} of ${this.total()} answered`;
    return this.deferred() === 0 ? said : `${said}, ${this.deferred()} for the builder`;
  });

  /** How much of the bar is filled. A width, and never a number anybody reads. */
  protected readonly filled = computed(() =>
    this.total() === 0 ? "0%" : `${(this.answered() / this.total()) * 100}%`,
  );
}
