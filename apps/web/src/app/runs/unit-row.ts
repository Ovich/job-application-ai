import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * The shell every unit of a run is drawn in: its sequence number, the mark its state
 * projects, what that state has to say, and the moment it ended when it has ended.
 *
 * The three states differ in their words and their colour, never in their geometry, so
 * the geometry is written once here and each state is a component of its own over it
 * (rule 16). Nothing in this file knows that `done`, `failed` or `pending` exist.
 */
@Component({
  selector: "unit-row",
  imports: [DatePipe],
  host: { class: "flex w-full items-baseline gap-3 px-4 py-3 text-ui" },
  template: `
    <span class="w-6 shrink-0 text-right font-mono text-label text-muted-foreground">{{
      seq()
    }}</span>&ngsp;<ng-content select="[mark]" />&ngsp;<ng-content />&ngsp;
    @if (endedAt(); as moment) {
      <time class="shrink-0 font-mono text-label text-muted-foreground" [attr.datetime]="moment">{{
        moment | date: "HH:mm:ss"
      }}</time>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitRow {
  /** The unit's position in its run, which is also the order it is read in. */
  readonly seq = input.required<number>();

  /** When the unit stopped, for the states that have stopped. */
  readonly endedAt = input<string | null>(null);
}
