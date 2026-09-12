import { Component, input, output } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * What is in scope, as a chip at the head of the composer (the builder's `ToolPrefix`).
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
  /** The thing in scope, in its own words: the item's title. */
  public readonly what = input.required<string>();

  public readonly clear = output<void>();
}
