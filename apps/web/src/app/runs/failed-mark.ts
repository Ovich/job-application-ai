import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * The mark of something that ended badly. Its square carries the meaning as much as
 * its colour does, so the state survives a reader who cannot tell the two apart.
 */
@Component({
  selector: "failed-mark",
  host: { class: "shrink-0 font-semibold text-danger" },
  template: `&#x25A0; failed`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FailedMark {}
