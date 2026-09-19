import { Component, input, output } from "@angular/core";
import { AppProviderMark, providerName } from "../../../auth/provider-mark/provider-mark";
import type { SignedIn } from "../../../auth/session";
import { UiBox } from "../../../ui/layout/box/box";
import { UiRow } from "../../../ui/layout/row/row";
import { UiSeparator } from "../../../ui/layout/separator/separator";
import { UiMenuItem } from "../../../ui/menu-item/menu-item";
import { UiText } from "../../../ui/typography/text/text";

/**
 * The account menu: the name, the address, the providers linked to the account, then
 * Sign out and Delete my account in the danger colour. The providers line exists
 * because linking is silent (D17), so a person needs somewhere to see how they
 * arrived; it names every linked provider in the order linked, since which one signed
 * them in is not knowable at the library's defaults (F1, D20).
 *
 * It calls nothing, owns no state and places itself nowhere: whoever draws it says where
 * it goes, in the `class` written on the element. That is what lets the left menu (D20)
 * hold these very rows at the foot of its panel while the bar still anchors them under
 * its account slot, with no second copy of them anywhere.
 */
@Component({
  selector: "app-account-menu",
  imports: [AppProviderMark, UiBox, UiMenuItem, UiRow, UiSeparator, UiText],
  host: { role: "menu", class: "block" },
  templateUrl: "./account-menu.html",
})
export class AppAccountMenu {
  public readonly user = input.required<SignedIn>();

  public readonly signOut = output<void>();

  /** The shell listens, through the bar: it opens the deletion gate (SL4). */
  public readonly deleteAccount = output<void>();

  protected readonly nameOf = (provider: SignedIn["providers"][number]): string =>
    providerName[provider];
}
