import { Component, input } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * The three figures in the assistant's first message (the mockup's `ReadingCard`):
 * documents read, facts each carrying its source, and the things only the person knows,
 * which counts down as questions are answered or skipped.
 *
 * **A figure the reading cannot honestly give is not drawn** (`F4`). Whether a count of
 * facts can be shown honestly is the spec's own open question; when the profile cannot
 * produce one, the figure is left out rather than invented. That is a departure from the
 * mockup's content and not from its design, and it is recorded as a finding.
 *
 * No score, no percentage and no money: the `CreditMeter` stays inert (`D4`).
 */
@Component({
  selector: "reading-card",
  imports: [UiText],
  templateUrl: "./reading-card.html",
})
export class ReadingCard {
  public readonly documents = input<number>(0);

  public readonly facts = input<number>(0);

  public readonly left = input<number>(0);
}
