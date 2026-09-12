import { Component, input, output, signal } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * The interview tool (`S4.3`, the spec's *The questions*, the mockup's `ScopeTool`).
 *
 * One question: where it sits, what is being asked, and the answers **as rows, never
 * cards** — two lines each, a radio glyph, the chosen one in the one blue. It is a
 * `ToggleGroup` in behaviour (single, nothing preselected) and rows in appearance, which
 * is what the handoff note asks for.
 *
 * **Nothing is preselected, because a preselection is a guess**, and a guess is the one
 * thing this slot exists to stop the product making.
 *
 * **Four answers at most, by the type.** The design language caps an exclusive choice at
 * four and the spec caps a question's answers at the same number, so the input is a
 * tuple of at most four and a fifth is a compile error rather than a review finding.
 *
 * The last row is always the person's own words: it carries no rule of its own and
 * picking it is what turns the composer into the answer.
 *
 * It calls nothing. The question arrives as an input and what the person did leaves as
 * an output; the person-opened shape of this tool, one fixed sentence and no proposal at
 * all, is `SL5`'s.
 */

/** One answer offered: two lines, and the rule picking it writes. */
export type Option = { id: string; label: string; hint: string; rule: string | null };

/** A question as the tool takes it. Four answers at most, and the type says so. */
export type OpenQuestion = {
  where: string;
  lead: string;
  options:
    | readonly [Option]
    | readonly [Option, Option]
    | readonly [Option, Option, Option]
    | readonly [Option, Option, Option, Option];
};

@Component({
  selector: "scope-tool",
  imports: [UiText],
  templateUrl: "./scope-tool.html",
})
export class ScopeTool {
  public readonly question = input.required<OpenQuestion>();

  /** The row the person pressed. One at a time; the parent decides what it means. */
  public readonly pick = output<{ optionId: string }>();

  public readonly skip = output<void>();

  /** Which row is marked. Nothing until the person says so. */
  protected readonly picked = signal<string | null>(null);

  protected choose(option: Option): void {
    this.picked.set(option.id);
    this.pick.emit({ optionId: option.id });
  }
}
