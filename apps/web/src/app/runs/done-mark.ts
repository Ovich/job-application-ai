import { ChangeDetectionStrategy, Component } from "@angular/core";

/** The mark of something that finished: the word and the colour it is said in. */
@Component({
  selector: "done-mark",
  host: { class: "shrink-0 font-semibold text-ok" },
  template: `&#x25CF; done`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoneMark {}
