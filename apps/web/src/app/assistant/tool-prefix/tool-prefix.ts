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
  // A flex item of the composer's row, and one that keeps what it needs: beside an input
  // that grows, a prefix left to shrink is crushed to its first letter (the person,
  // 2026-09-12). It takes its content's width, up to the ceiling the chip carries.
  host: { class: "flex shrink-0 items-center" },
})
export class ToolPrefix {
  /** The word the use case names the relation with: `Scope` in the intake. */
  public readonly label = input.required<string>();

  public readonly clear = output<void>();
}
