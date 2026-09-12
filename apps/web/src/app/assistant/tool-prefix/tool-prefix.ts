import { Component, input, output } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * What a tool is working on, as a chip at the head of the composer. **Abstract**: the
 * word that names the relation is an input, so a use case supplies its own — the
 * intake's is *Scope*, and a builder's will be its own word — and this component holds
 * none of them.
 *
 * Its × is `clear`, and what `clear` means is the parent's: **while a question waits it
 * is a skip**, and the dock closes only when nothing is left (the mockup's handoff
 * note). This component decides nothing about that; it says the × was pressed.
 */
@Component({
  selector: "tool-prefix",
  imports: [UiText],
  templateUrl: "./tool-prefix.html",
})
export class ToolPrefix {
  /** The word the use case names the relation with: `Scope` in the intake. */
  public readonly label = input.required<string>();

  /** The thing the tool is working on, in its own words: the item's title. */
  public readonly what = input.required<string>();

  public readonly clear = output<void>();
}
