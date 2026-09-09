import { ChangeDetectionStrategy, Component } from "@angular/core";

/** The mark of something that has not happened: an open circle, and quiet. */
@Component({
  selector: "pending-mark",
  host: { class: "shrink-0 text-muted-foreground" },
  template: `&#x25CB; pending`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingMark {}
