import { Component, computed, input } from "@angular/core";
import { UiBox } from "../layout/box/box";
import { UiRow } from "../layout/row/row";
import { UiText } from "../typography/text/text";

/**
 * One message above the content, in the tone it is in (ID82): its lead in the semibold
 * weight, then whatever the caller projects as its body. A danger notice is an alert, so
 * a screen reader announces it at once; an ok notice is a status, announced when the
 * reader is idle. The glyph's shape carries the meaning without the colour: a square
 * for a failure, a round for a success.
 */
@Component({
  selector: "app-notice",
  imports: [UiRow, UiBox, UiText],
  templateUrl: "./notice.html",
  host: { "[attr.role]": "role()" },
})
export class Notice {
  public readonly tone = input.required<"ok" | "danger">();

  public readonly lead = input.required<string>();

  protected readonly role = computed(() => (this.tone() === "danger" ? "alert" : "status"));

  protected readonly surface = computed(() =>
    this.tone() === "danger" ? "danger-soft" : "ok-soft",
  );
}
