import { Component, input } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * That the profile assistant flagged an item for review, and what the person's answer
 * settled about it (D16, the mockup's `ProfileSheet`): `▲` with `scope to clarify` beside
 * it while the item is flagged and has no profile concern, and the check line,
 * `✓ <the concern>`, once one is kept.
 *
 * It is one component and not eight copies of the same markup, because a region is a
 * chip, a line, a project, a post or a diploma and every one of them carries this. It
 * renders what comes in and owns nothing.
 */
@Component({
  selector: "profile-review-flag",
  imports: [UiText],
  templateUrl: "./profile-review-flag.html",
})
export class ProfileReviewFlag {
  /** The item's question, if the assistant flagged it: its state. */
  public readonly review = input.required<{ state: string } | null>();

  /** The item's current profile concern, if one is kept. */
  public readonly concern = input.required<{ text: string } | null>();
}
