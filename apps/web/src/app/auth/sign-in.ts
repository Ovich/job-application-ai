import { DOCUMENT } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { Meta, Title } from "@angular/platform-browser";
import { ActivatedRoute } from "@angular/router";
import { Wordmark } from "../shell/wordmark";
import { authClient } from "./auth-client";
import { ProviderButton } from "./provider-button";
import { providerName } from "./provider-mark";
import { isProvider, type Provider } from "./session";

/**
 * The entry route (S3.1): no AppBar, one centred column at 420 px. The wordmark, an
 * `h1`, one sentence, three provider buttons in D4's order, and a link to what is kept
 * and how to delete it. No hero, no feature grid, no illustration: content is allowed
 * where decoration is not, and this is the smallest content that states the concept.
 * No password field, because there is nothing to create (D11).
 *
 * A press asks the library's client for that provider's sign-in and names this route as
 * where to come back to on failure, `/?failed=<provider>`, to which the library appends
 * its own `error`. What follows is the library's: it answers with the provider's
 * address, the client sends the browser there, and the provider sends it back to
 * `/api/auth/callback/<provider>`, where the library sets the cookie and returns the
 * browser to `callbackURL`. Nothing here reads a token or builds a redirect.
 *
 * The address it reads, three names (F8): `error`, written by the library; `failed`,
 * written by this route; `deleted`, written by SL4. Never storage, and never as a sign
 * of being signed in: that is the guard's, over `get-session` (ID74).
 *
 * The head is this route's and not `index.html`'s: a title and a canonical there would
 * stamp every route with the entry page's identity. Set where the route renders, they
 * are what the prerender writes into the built HTML of `/` (ID63, ID77).
 */
@Component({
  selector: "app-sign-in",
  imports: [Wordmark, ProviderButton],
  template: `
    <main class="grid min-h-screen place-items-center px-5 pt-10 pb-14">
      <div class="flex w-full max-w-[420px] flex-col gap-7">
        <app-wordmark class="justify-center text-[20px]" />

        <h1 class="m-0 text-center text-figure font-semibold tracking-[-0.01em] leading-[1.35]">
          Your job application in the era of AI
        </h1>

        <p class="-mt-3.5 m-0 text-center text-body text-muted-foreground">
          A tailored CV and cover letter for every job offer. Let the silence stop.
        </p>

        @if (failed(); as provider) {
          <div role="alert" class="flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3.5 text-ui text-danger">
            <span class="mt-[0.45em] size-2.5 shrink-0 bg-current" aria-hidden="true"></span>
            <span>
              <span class="font-semibold">{{ nameOf(provider) }} did not finish signing you in.</span>
              Nothing was created and nothing was charged. Try again, or continue with another account.
            </span>
          </div>
        }

        @if (deleted()) {
          <div role="status" class="flex items-start gap-3 rounded-md bg-ok-soft px-4 py-3.5 text-ui text-ok">
            <span class="mt-[0.45em] size-2.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
            <span>
              <span class="font-semibold">Your account is deleted.</span>
              Everything it held is gone. You are welcome back any time, from nothing.
            </span>
          </div>
        }

        <div class="flex flex-col gap-2.5">
          @for (provider of providers; track provider) {
            <app-provider-button
              [provider]="provider"
              [busy]="pressed() === provider"
              [disabled]="pressed() !== null && pressed() !== provider"
              (pressed)="continueWith(provider)"
            />
          }
        </div>

        <p class="m-0 text-center text-caption text-muted-foreground">
          <a class="underline underline-offset-[3px]">What we keep, and how to delete it</a>
        </p>
      </div>
    </main>
  `,
})
export class SignIn {
  /** The three of D4, in this order: Google first, LinkedIn last. */
  protected readonly providers: readonly Provider[] = ["google", "microsoft", "linkedin"];

  /** The provider whose door the browser is leaving for, once one is pressed. */
  protected readonly pressed = signal<Provider | null>(null);

  private readonly address = toSignal(inject(ActivatedRoute).queryParamMap);

  /** The provider a failed sign-in came back from: `failed=<provider>` with the library's `error`. */
  protected readonly failed = computed<Provider | null>(() => {
    const params = this.address();
    const provider = params?.get("failed");
    return params?.has("error") &&
      provider !== null &&
      provider !== undefined &&
      isProvider(provider)
      ? provider
      : null;
  });

  /** SL4's trigger: the address carries `deleted`. */
  protected readonly deleted = computed(() => this.address()?.has("deleted") ?? false);

  protected readonly nameOf = (provider: Provider): string => providerName[provider];

  public constructor() {
    inject(Title).setTitle("AI CV builder for every job offer | job-application.app");
    inject(Meta).updateTag({
      name: "description",
      content:
        "Your job application in the era of AI. A tailored CV and cover letter for every job offer. Let the silence stop. Built from one profile made of the CVs you already have.",
    });
    const document = inject(DOCUMENT);
    const canonical =
      document.head.querySelector<HTMLLinkElement>("link[rel=canonical]") ??
      document.head.appendChild(document.createElement("link"));
    canonical.rel = "canonical";
    canonical.href = "https://job-application.app/";
  }

  protected async continueWith(provider: Provider): Promise<void> {
    this.pressed.set(provider);
    await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: `/?failed=${provider}`,
    });
  }
}
