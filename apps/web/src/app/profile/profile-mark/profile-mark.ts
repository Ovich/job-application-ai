import { Component, input } from "@angular/core";
import { UiText } from "../../ui/typography/text/text";

/**
 * The two things a region says about itself once the assistant has been through it (the
 * mockup's `ProfileSheet`): the ask mark, `▲` with `scope to clarify` beside it while a
 * question waits, and the check line, `✓ <the answer>`, once one has been answered.
 *
 * It is one component and not eight copies of the same markup, because a region is a
 * chip, a line, a project, a post or a diploma and every one of them carries this. It
 * renders what comes in and owns nothing.
 */

/** As much of an item as the mark reads: its question, if any, and its current rule. */
export type Marked = {
  question: { state: string } | null;
  rule: { text: string } | null;
};

@Component({
  selector: "profile-mark",
  imports: [UiText],
  templateUrl: "./profile-mark.html",
})
export class ProfileMark {
  public readonly of = input.required<Marked>();
}
