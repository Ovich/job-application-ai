import { Component, input, output } from "@angular/core";
import { HlmBtn } from "../../ui/hlm-button";
import { UiRow } from "../../ui/layout/row/row";
import { UiText } from "../../ui/typography/text/text";

/**
 * The bar above the profile (`D5`, `D20`, the mockup's top row beside the menu square):
 * who the profile is, when it was read, and the two things a person does next.
 *
 * It owns nothing. The name and the read line arrive as words already composed, because
 * what "read" means is a question about the answer and not about a bar, and the two
 * buttons go out as they came in.
 *
 * **The second line is a date and never a count** (product-flow-rework `H10`, `ID331`):
 * "Read 14 September", not "From 2 documents, read today". How many documents a profile
 * was built from is bookkeeping, and a person reading their profile is not doing any.
 *
 * **There is no view toggle** (`S2.1`): the page is one column, so there is nothing left
 * to switch between.
 */
@Component({
  selector: "profile-bar",
  imports: [HlmBtn, UiRow, UiText],
  templateUrl: "./profile-bar.html",
})
export class ProfileBar {
  public readonly name = input<string>("");

  public readonly readLine = input<string>("");

  public readonly addDocuments = output<void>();

  public readonly startApplication = output<void>();
}
