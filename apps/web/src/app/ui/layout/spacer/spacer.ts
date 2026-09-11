import { Directive } from "@angular/core";

/** The pusher in a row (ID81): it takes the remaining room, and nothing else. */
@Directive({
  selector: "[uiSpacer]",
  host: { class: "flex-1" },
})
export class UiSpacer {}
