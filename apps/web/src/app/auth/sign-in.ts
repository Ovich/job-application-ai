import { Component } from "@angular/core";
import { HlmButton } from "../ui/hlm-button";
import { authClient } from "./auth-client";

/**
 * The bare entry: one button, and nothing of the design. It proves US1 on localhost —
 * a person presses it, signs in at Google, and lands back signed in — and SL3 replaces
 * it with the entry route as drawn.
 *
 * The press asks the library's client for a social sign-in with Google. What follows
 * is the library's: it answers with Google's address, the client sends the browser
 * there, and Google sends it back to `/api/auth/callback/google`, where the library
 * sets the session cookie and returns the browser to `callbackURL`. Nothing here
 * reads a token or builds a redirect.
 */
@Component({
  selector: "app-sign-in",
  imports: [HlmButton],
  template: `
    <main class="flex min-h-screen items-center justify-center">
      <button hlmBtn type="button" (click)="continueWithGoogle()">Continue with Google</button>
    </main>
  `,
})
export class SignIn {
  protected async continueWithGoogle(): Promise<void> {
    await authClient.signIn.social({ provider: "google", callbackURL: "/" });
  }
}
