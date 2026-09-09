import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { PendingMark } from "./pending-mark";
import { UnitRow } from "./unit-row";

/**
 * A unit that has not run. It has no result and no moment, and says so in words rather
 * than leaving an empty column a reader would have to interpret.
 */
@Component({
  selector: "li[pendingUnit]",
  imports: [PendingMark, UnitRow],
  template: `
    <unit-row [seq]="seq()">
      <pending-mark mark />
      <span class="min-w-0 flex-1 text-muted-foreground">not started yet</span>
    </unit-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingUnit {
  readonly seq = input.required<number>();
}
