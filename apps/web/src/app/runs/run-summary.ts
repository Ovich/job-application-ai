import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * What the run is, in one quiet line under the heading: its kind, when it started, and
 * whether it has ended. It is the only place the run's own columns are read; a unit row
 * knows nothing about the run it belongs to.
 */
@Component({
  selector: "run-summary",
  imports: [DatePipe],
  host: { class: "text-caption text-muted-foreground" },
  template: `
    <span>{{ kind() }}</span>
    <span aria-hidden="true"> &middot; </span>
    <span>started {{ createdAt() | date: "d MMM y, HH:mm" }}</span>
    <span aria-hidden="true"> &middot; </span>
    @if (finishedAt(); as moment) {
      <span>finished {{ moment | date: "HH:mm" }}</span>
    } @else {
      <span>still running</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunSummary {
  readonly kind = input.required<string>();
  readonly createdAt = input.required<string>();
  readonly finishedAt = input.required<string | null>();
}
