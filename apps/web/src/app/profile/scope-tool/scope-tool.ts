import { Component, computed, input, output, signal } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * The interview tool, in its two shapes (`S4.3`, `S5.1`, the spec's *The questions*, the
 * mockup's `ScopeTool`).
 *
 * **Asked by the assistant**: one question — where it sits, what is being asked, and the
 * answers **as rows, never cards** — two lines each, a radio glyph, the chosen one in the
 * one blue. It is a `ToggleGroup` in behaviour (single, nothing preselected) and rows in
 * appearance, which is what the handoff note asks for. Nothing is preselected, because a
 * preselection is a guess, and a guess is the one thing this slot exists to stop the
 * product making. Four answers at most, by the type: the design language caps an
 * exclusive choice at four and the spec caps a question's answers at the same number, so
 * a fifth is a compile error rather than a review finding. The last row is always the
 * person's own words: it carries no rule of its own and picking it is what turns the
 * composer into the answer.
 *
 * **Opened by the person**: one fixed sentence and the composer, and nothing else at all
 * (`US8`, `D7`, the person's sentence of 2026-09-12). The reader found no question there,
 * so a suggested answer would be the product inventing one.
 *
 * **The input is what makes the second shape unable to propose**, rather than merely
 * empty: a `clarification` carries no option to render, so there is no state of this
 * component in which a proposed answer exists and is hidden. A shared state with the
 * options suppressed would be one bug away from suggesting an answer to a question the
 * reader never asked, which is the one claim this product makes.
 *
 * **It never names what is in scope.** The clicked thing's own text is the prefix's, at
 * the head of the composer; a lead composed about it — "Your part in Kubernetes at
 * Nestlé" — would be an inference in a smaller place.
 *
 * It calls nothing. What is open arrives as an input and what the person did leaves as
 * an output.
 */

/** One answer offered: two lines, and the rule picking it writes. */
export type Option = { id: string; label: string; hint: string; rule: string | null };

/** A question as the tool takes it. Four answers at most, and the type says so. */
export type OpenQuestion = {
  kind: "asked";
  where: string;
  lead: string;
  options:
    | readonly [Option]
    | readonly [Option, Option]
    | readonly [Option, Option, Option]
    | readonly [Option, Option, Option, Option];
};

/**
 * The tool the person opened themselves. It carries **where** they are and nothing else:
 * the sentence is fixed, and there is no field here for a proposal to arrive in.
 *
 * `where` is a path — `R&D Collaborator in Software Engineering · row 3` — and never
 * the thing's own words (the person, 2026-09-13). The sheet has lifted what was
 * clicked, so repeating a bullet's sentence here says it twice; what a person cannot
 * see from the highlight alone is which row of which item they are about to write on.
 */
export type Clarification = { kind: "clarification"; where: string };

/** What is open in the dock: a question that was asked, or one the person opened. */
export type OpenTool = OpenQuestion | Clarification;

@Component({
  selector: "scope-tool",
  imports: [UiText],
  templateUrl: "./scope-tool.html",
})
export class ScopeTool {
  public readonly tool = input.required<OpenTool>();

  /** The row the person pressed. One at a time; the parent decides what it means. */
  public readonly pick = output<{ optionId: string }>();

  public readonly skip = output<void>();

  /** The question, when one was asked. `null` is the shape that proposes nothing. */
  protected readonly asked = computed<OpenQuestion | null>(() => {
    const tool = this.tool();
    return tool.kind === "asked" ? tool : null;
  });

  /** Which row is marked. Nothing until the person says so. */
  protected readonly picked = signal<string | null>(null);

  protected choose(option: Option): void {
    this.picked.set(option.id);
    this.pick.emit({ optionId: option.id });
  }
}
