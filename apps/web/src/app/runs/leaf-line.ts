import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * The shell every leaf of a stream is drawn in. It holds the geometry of a line and
 * names no leaf: `text` and `progress` differ in what they say, never in how the line
 * sits, so the line is written once here and each kind is a component of its own over
 * it (rule 16).
 *
 * It is the stream's shell and not the run's, `unit-row` being the shell of a stored
 * unit. The two look alike on purpose and are not the same thing: one draws a row read
 * from the database, with a moment it ended, and this one draws something that has
 * just arrived and has no history yet.
 */
@Component({
  selector: "leaf-line",
  host: { class: "flex w-full items-baseline gap-3 px-4 py-3 text-ui" },
  template: `<ng-content />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeafLine {}
