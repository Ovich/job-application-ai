import { Component, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { authClient } from "../auth/auth-client";
import { type SignedIn, session } from "../auth/session";
import { AppBar } from "./app-bar";

/**
 * The layout above the signed-in routes (ID75): the AppBar, fed by `session()`, and
 * the outlet below it, empty in this slot. The route component of `/profile`.
 *
 * The session is read once when the shell activates. The guard (ID74) has already
 * sent a signed-out browser to `/`, so an empty answer here is not drawn. On the bar's
 * signOut, the library's own client signs out and the router goes to the entry route;
 * a sign-out the library refuses leaves the person here, still signed in, the menu
 * closed, and nothing is reported in this slot. Delete my account is SL4's to listen to.
 */
@Component({
  selector: "app-shell",
  imports: [RouterOutlet, AppBar],
  host: { class: "flex min-h-screen flex-col" },
  template: `
    @if (user(); as user) {
      <app-app-bar [user]="user" (signOut)="signOut()" />
    }
    <main class="flex-1"><router-outlet /></main>
  `,
})
export class AppShell {
  protected readonly user = signal<SignedIn | null>(null);

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
}
