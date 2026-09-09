import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { DoneMark } from "./done-mark";
import { FailedMark } from "./failed-mark";
import { LeafLine } from "./leaf-line";
import { PendingMark } from "./pending-mark";
import type { UnitStatus } from "./stream-frame";

/**
 * One unit of the run reaching a state. It says which unit and what became of it, and
 * that is all a progress leaf carries: a result belongs to the stored unit, which the
 * page above reads from the database once the run is over.
 *
 * The state is a named component and never a class chosen by a condition (rule 16), so
 * the same three marks appear here and in a stored unit's row, written once each.
 */
@Component({
  selector: "li[progressLeaf]",
  imports: [DoneMark, FailedMark, LeafLine, PendingMark],
  template: `
    <leaf-line>
      <span class="w-6 shrink-0 text-right font-mono text-label text-muted-foreground">{{
        seq()
      }}</span>
      @switch (status()) {
        @case ("done") {
          <done-mark />
        }
        @case ("failed") {
          <failed-mark />
        }
        @case ("pending") {
          <pending-mark />
        }
      }
    </leaf-line>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressLeaf {
  /** The unit's position in the run, which is not the frame's position in the stream. */
  readonly seq = input.required<number>();
  readonly status = input.required<UnitStatus>();
}
