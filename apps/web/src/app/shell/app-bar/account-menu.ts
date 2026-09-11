import { Component, input, output } from "@angular/core";
import { ProviderMark, providerName } from "../../auth/provider-mark";
import type { SignedIn } from "../../auth/session";

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
  imports: [ProviderMark],
  host: {
    role: "menu",
    class:
      "absolute top-11 right-0 z-10 block w-[270px] rounded-md border border-border bg-card p-1.5 shadow-card",
  },
  template: `
    <div class="mb-1.5 border-b border-border px-3 pt-3 pb-2.5">
      <div class="text-ui font-semibold">{{ user().name }}</div>
      <div class="break-all text-caption text-muted-foreground">{{ user().email }}</div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-label text-muted-foreground">
        @if (user().providers.length === 1) {
          <app-provider-mark [provider]="user().providers[0]!" sizeClass="size-3.5" />
          <span>Signed in with {{ nameOf(user().providers[0]!) }}</span>
        } @else {
          <span>Linked:</span>
          @for (provider of user().providers; track provider; let last = $last) {
            <app-provider-mark [provider]="provider" sizeClass="size-3.5" />
            <span>{{ nameOf(provider) }}{{ last ? "" : "," }}</span>
          }
        }
      </div>
    </div>
    <button
      type="button"
      role="menuitem"
      class="block w-full rounded-md px-3 py-2.5 text-left text-ui hover:bg-muted"
      (click)="signOut.emit()"
    >
      Sign out
    </button>
    <button
      type="button"
      role="menuitem"
      class="block w-full rounded-md px-3 py-2.5 text-left text-ui text-danger hover:bg-muted"
      (click)="deleteAccount.emit()"
    >
      Delete my account
    </button>
  `,
})
export class AccountMenu {
  public readonly user = input.required<SignedIn>();

  public readonly signOut = output<void>();

  /** SL4 listens; nobody in this slice. */
  public readonly deleteAccount = output<void>();

  protected readonly nameOf = (provider: SignedIn["providers"][number]): string =>
    providerName[provider];
}
