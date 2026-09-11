import { NgTemplateOutlet } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { authClient } from "../../auth/auth-client";
import { providerName } from "../../auth/provider-mark/provider-mark";
import { type Provider, type SignedIn, session } from "../../auth/session";
import { AppConfirmAction } from "../../ui/confirm-action/confirm-action";
import { UiPage } from "../../ui/layout/page/page";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppNotice } from "../../ui/notice/notice";
import { UiText } from "../../ui/typography/text/text";
import { AppBar } from "../app-bar/app-bar";

/** The deletion gate while it is open: who it deletes, and how the deletion is going. */
type Gate = { providers: Provider[]; working: boolean; failed: boolean };

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
  protected readonly user = signal<SignedIn | null>(null);

  /** The deletion gate: created when open, destroyed when closed, so each opening has a new code. */
  protected readonly gate = signal<Gate | null>(null);

  protected readonly nameOf = (provider: Provider): string => providerName[provider];

  private readonly router = inject(Router);

  public constructor() {
    void session().then((who) => {
      this.user.set(who);
    });
  }

  protected async signOut(): Promise<void> {
    const { error } = await authClient.signOut();
    if (error) {
      return;
    }
    await this.router.navigateByUrl("/");
  }

  protected async openGate(): Promise<void> {
    const who = await session().catch(() => null);
    if (who === null) {
      await this.router.navigateByUrl("/");
      return;
    }
    this.user.set(who);
    this.gate.set({ providers: who.providers, working: false, failed: false });
  }

  protected closeGate(): void {
    this.gate.set(null);
  }

  protected async deleteAccount(): Promise<void> {
    this.gate.update((gate) => gate && { ...gate, working: true, failed: false });
    const deleted = await authClient.deleteUser().then(
      ({ error }) => error === null,
      () => false,
    );
    if (deleted) {
      await this.router.navigateByUrl("/?deleted");
      return;
    }
    this.gate.update((gate) => gate && { ...gate, working: false, failed: true });
  }
}
