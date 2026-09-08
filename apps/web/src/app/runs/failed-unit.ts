import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { UnitRow } from "./unit-row";

/**
 * A unit that ended badly. It reads like a finished one on purpose: the same row, the
 * same result column, so the eye finds the failure by its colour and its square rather
 * than by a shape it has to learn.
 */
@Component({
  selector: "li[failedUnit]",
  imports: [UnitRow],
  host: { class: "bg-danger-soft" },
  template: `
    <unit-row [seq]="seq()" [endedAt]="doneAt()">
      <span mark class="shrink-0 font-semibold text-danger">&#x25A0; failed</span>
      <span class="min-w-0 flex-1">{{ result() ?? "no result recorded" }}</span>
    </unit-row>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FailedUnit {
  readonly seq = input.required<number>();
  readonly result = input.required<string | null>();
  readonly doneAt = input.required<string | null>();
}
