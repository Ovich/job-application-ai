import { Component, inject, signal, viewChild } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { CurrentUser } from "../../auth/current-user";
import { AppDeleteAccount } from "../../auth/delete-account/delete-account";
import { UiPage } from "../../ui/layout/page/page";
import { UiRow } from "../../ui/layout/row/row";
import { UiStack } from "../../ui/layout/stack/stack";
import { LeftMenu } from "../left-menu/left-menu";
import { MenuButton } from "../menu-button/menu-button";
import { AppWordmark } from "../wordmark/wordmark";

/**
 * The layout above the signed-in routes (ID75, D20): the top row — the menu square and
 * the wordmark beside it — and the outlet below it. The route component of `/`, `/profile`
 * and `/documents`.
 *
 * **The AppBar is gone from every route.** What it held is the left menu's now, and the
 * shell is what opens it: it holds the one boolean, hands the person down as an input and
 * listens. Escape and the panel's own close both come back as `close`, and the shell puts
 * the focus back on the square, because the square is the shell's element and not the
 * menu's.
 *
 * The guard (ID74) has already asked the library and sent a signed-out browser to `/`'s
 * sign-in branch, so the person is there when the shell renders. What the menu asks for
 * goes to `CurrentUser` (ID99), which does it and decides where the browser goes: Sign
 * out, and Delete my account, which opens the deletion (ID84).
 *
 * While the deletion is open the shell draws `app-delete-account` under the square, where
 * the menu was (ID94's controlled mode): created when it opens and destroyed when it
 * closes, so each opening starts at the warning. The shell hands it the linked providers
 * and the deletion's state, and hands its confirm and cancel back to the service.
 */
@Component({
  selector: "app-shell",
  imports: [
    RouterOutlet,
    AppDeleteAccount,
    AppWordmark,
    LeftMenu,
    MenuButton,
    UiPage,
    UiRow,
    UiStack,
  ],
  templateUrl: "./app-shell.html",
})
export class AppShell {
  private readonly currentUser = inject(CurrentUser);

  protected readonly user = this.currentUser.person;

  protected readonly deletion = this.currentUser.deletion;

  /** Whether the left menu is open: the one piece of state the shell owns. */
  protected readonly menuOpen = signal(false);

  private readonly square = viewChild<MenuButton>(MenuButton);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** The menu closes and the focus goes back to the square it came from. */
  protected closeMenu(): void {
    this.menuOpen.set(false);
    this.square()?.focus();
  }

  protected signOut(): Promise<void> {
    this.menuOpen.set(false);
    return this.currentUser.signOut();
  }

  protected openDeletion(): Promise<void> {
    this.menuOpen.set(false);
    return this.currentUser.openDeletion();
  }

  protected closeDeletion(): void {
    this.currentUser.closeDeletion();
  }

  protected deleteAccount(): Promise<void> {
    return this.currentUser.deleteAccount();
  }
}
