import { Component } from "@angular/core";
import { HlmButton } from "../ui/hlm-button";
import { authClient } from "./auth-client";

/**
 * The bare entry: one button per provider, and nothing of the design. It proves US1
 * and US2 on localhost — a person presses one, signs in at the provider, and lands
 * back signed in; presses another with the same address, and lands on the same user —
 * and SL3 replaces it with the entry route as drawn.
 *
 * A press asks the library's client for a social sign-in with the provider the button
 * names. What follows is the library's: it answers with the provider's address, the
 * client sends the browser there, and the provider sends it back to
 * `/api/auth/callback/<provider>`, where the library sets the session cookie and
 * returns the browser to `callbackURL`. Nothing here reads a token or builds a redirect.
 */
@Component({
  selector: "app-sign-in",
  imports: [HlmButton],
  template: `
    <main class="flex min-h-screen flex-col items-center justify-center gap-3">
      <button hlmBtn type="button" (click)="continueWith('google')">Continue with Google</button>
      <button hlmBtn type="button" (click)="continueWith('microsoft')">
        Continue with Microsoft
      </button>
      <button hlmBtn type="button" (click)="continueWith('linkedin')">
        Continue with LinkedIn
      </button>
    </main>
  `,
})
export class SignIn {
  protected async continueWith(provider: "google" | "microsoft" | "linkedin"): Promise<void> {
    await authClient.signIn.social({ provider, callbackURL: "/" });
  }
}
