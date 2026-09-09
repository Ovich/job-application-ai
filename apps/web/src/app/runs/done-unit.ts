import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { DoneMark } from "./done-mark";
import { UnitRow } from "./unit-row";

/** A unit that finished: its result in full, and the moment it was written. */
@Component({
  selector: "li[doneUnit]",
  imports: [DoneMark, UnitRow],
  template: `
    <unit-row [seq]="seq()" [endedAt]="doneAt()">
      <done-mark mark />
      <span class="min-w-0 flex-1">{{ result() ?? "no result recorded" }}</span>
    </unit-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoneUnit {
  readonly seq = input.required<number>();
  readonly result = input.required<string | null>();
  readonly doneAt = input.required<string | null>();
}
