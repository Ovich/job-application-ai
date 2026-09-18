import { Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { HlmBtn } from "../../ui/hlm-button";
import { UiRow } from "../../ui/layout/row/row";
import { UiText } from "../../ui/typography/text/text";

/**
 * The bar above the profile (`D5`, the mockup's right column): who the profile is, what
 * it was read from, and the two things a person does next.
 *
 * It owns nothing. The name and the read line arrive as words already composed, because
 * what "read today" means is a question about the answer and not about a bar, and the
 * two buttons go out as they came in: `startApplication` is inert in this slice, and
 * `addDocuments` is the way back the empty profile needs.
 *
 * The one thing it decides for itself is the link to `/documents` (SL11): a route, not an
 * event, so the only component that can hold it is the one that draws it.
 *
 * The toggle is drawn only below 1024 px, where one column is shown at a time. Its two
 * labels are the mockup's own.
 */
@Component({
  selector: "profile-bar",
  imports: [HlmBtn, RouterLink, UiRow, UiText],
  templateUrl: "./profile-bar.html",
})
export class ProfileBar {
  public readonly name = input<string>("");

  public readonly readLine = input<string>("");

  /** Which column is showing, below 1024 px. Above it, both are and this is unused. */
  public readonly view = input<"sheet" | "chat">("sheet");

  public readonly addDocuments = output<void>();

  public readonly startApplication = output<void>();

  public readonly toggleView = output<void>();
}
