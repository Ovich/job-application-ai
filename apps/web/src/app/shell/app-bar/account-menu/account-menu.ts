import { Component, input, output } from "@angular/core";
import { AppProviderMark, providerName } from "../../../auth/provider-mark/provider-mark";
import type { SignedIn } from "../../../auth/session";
import { UiBox } from "../../../ui/layout/box/box";
import { UiRow } from "../../../ui/layout/row/row";
import { UiText } from "../../../ui/typography/text/text";

/**
 * The account menu: the name, the address, the providers linked to the account, then
 * Sign out and Delete my account in the danger colour. The providers line exists
 * because linking is silent (D17), so a person needs somewhere to see how they
 * arrived; it names every linked provider in the order linked, since which one signed
 * them in is not knowable at the library's defaults (F1, D20).
 *
 * It calls nothing and owns no state: the bar opens and closes it and forwards its
 * outputs. Anchored under the slot by the bar's own positioning, without an overlay:
 * one menu of two items does not yet earn a popover component.
 */
@Component({
  selector: "app-account-menu",
  imports: [AppProviderMark, UiBox, UiRow, UiText],
  host: { role: "menu", class: "absolute top-11 right-0 z-10 block w-[270px]" },
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
