import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { CurrentUser } from "../../auth/current-user";
import { AppDeleteAccount } from "../../auth/delete-account/delete-account";
import { UiPage } from "../../ui/layout/page/page";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppBar } from "../app-bar/app-bar";

/**
 * The layout above the signed-in routes (ID75): the AppBar, fed by `CurrentUser`'s
 * person, and the outlet below it, empty in this slot. The route component of `/profile`.
 *
 * The guard (ID74) has already asked the library and sent a signed-out browser to `/`,
 * so the person is there when the shell renders. What the bar's menu asks for goes to
 * `CurrentUser` (ID99), which does it and decides where the browser goes: Sign out, and
 * Delete my account, which opens the deletion (ID84).
 *
 * While the deletion is open the shell draws `app-delete-account` under the account slot,
 * where the menu was (ID94's controlled mode): created when it opens and destroyed when it
 * closes, so each opening starts at the warning. The shell hands it the linked providers
 * and the deletion's state, and hands its confirm and cancel back to the service.
 */
@Component({
  selector: "app-shell",
  imports: [RouterOutlet, AppBar, AppDeleteAccount, UiStack, UiPage],
  templateUrl: "./app-shell.html",
})
export class AppShell {
  private readonly currentUser = inject(CurrentUser);

  protected readonly user = this.currentUser.person;

  protected readonly deletion = this.currentUser.deletion;

  protected signOut(): Promise<void> {
    return this.currentUser.signOut();
  }

  protected openDeletion(): Promise<void> {
    return this.currentUser.openDeletion();
  }

  protected closeDeletion(): void {
    this.currentUser.closeDeletion();
  }

  protected deleteAccount(): Promise<void> {
    return this.currentUser.deleteAccount();
  }
}
