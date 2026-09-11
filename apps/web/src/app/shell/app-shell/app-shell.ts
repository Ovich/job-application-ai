import { NgTemplateOutlet } from "@angular/common";
import { Component, computed, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { CurrentUser } from "../../auth/current-user";
import { providerName } from "../../auth/provider-mark/provider-mark";
import type { Provider } from "../../auth/session";
import { AppConfirmAction } from "../../ui/confirm-action/confirm-action";
import { UiPage } from "../../ui/layout/page/page";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppNotice } from "../../ui/notice/notice";
import { UiText } from "../../ui/typography/text/text";
import { AppBar } from "../app-bar/app-bar";

/**
 * The layout above the signed-in routes (ID75): the AppBar, fed by `session()`, and
 * the outlet below it, empty in this slot. The route component of `/profile`.
 *
 * The session is read once when the shell activates. The guard (ID74) has already
 * sent a signed-out browser to `/`, so an empty answer here is not drawn. On the bar's
 * signOut, the library's own client signs out and the router goes to the entry route;
 * a sign-out the library refuses leaves the person here, still signed in, the menu
 * closed, and nothing is reported in this slot.
 *
 * On the bar's deleteAccount (ID84), `session()` is read again, so what the gate says
 * goes is read at open, and the confirm gate is created under the account slot, where
 * the menu was (ID94's controlled mode), with the deletion's own content projected into
 * it: the message, one line per linked provider, the money callout, and the failure when
 * there is one. The content is the shell's, the gate's one caller, since the gate is
 * every consequential action's and the membership sentence is this deletion's alone.
 * No session, or no library, at open is the guards' answer: the entry route.
 *
 * Its confirmation asks the library's client for `delete-user` (ID70) and, deleted, the
 * router goes to `/?deleted` (F8): the library has cleared the cookie itself, so nothing
 * here signs out or remembers anything. A failure keeps the gate as it was with the
 * failure at the end of its body, and the person still signed in here.
 */
@Component({
  selector: "app-shell",
  imports: [
    NgTemplateOutlet,
    RouterOutlet,
    AppBar,
    AppConfirmAction,
    AppNotice,
    UiStack,
    UiPage,
    UiText,
  ],
  templateUrl: "./app-shell.html",
})
export class AppShell {
  private readonly currentUser = inject(CurrentUser);

  protected readonly user = this.currentUser.person;

  /** The deletion gate: created when open, destroyed when closed, so each opening has a new code. */
  protected readonly gate = computed(() => {
    const deletion = this.currentUser.deletion();
    return deletion && { ...deletion, providers: this.user()?.providers ?? [] };
  });

  protected readonly nameOf = (provider: Provider): string => providerName[provider];

  protected signOut(): Promise<void> {
    return this.currentUser.signOut();
  }

  protected openGate(): Promise<void> {
    return this.currentUser.openDeletion();
  }

  protected closeGate(): void {
    this.currentUser.closeDeletion();
  }

  protected deleteAccount(): Promise<void> {
    return this.currentUser.deleteAccount();
  }
}
