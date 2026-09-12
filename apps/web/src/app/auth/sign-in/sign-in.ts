import { DOCUMENT } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { Meta, Title } from "@angular/platform-browser";
import { ActivatedRoute } from "@angular/router";
import { AppWordmark } from "../../shell/wordmark/wordmark";
import { UiBox } from "../../ui/layout/box/box";
import { UiContainer } from "../../ui/layout/container/container";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppNotice } from "../../ui/notice/notice";
import { UiText } from "../../ui/typography/text/text";
import { authClient } from "../auth-client";
import { AppProviderButton } from "../provider-button/provider-button";
import { providerName } from "../provider-mark/provider-mark";
import { isProvider, type Provider } from "../session";

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
  imports: [AppWordmark, AppProviderButton, AppNotice, UiStack, UiContainer, UiBox, UiText],
  templateUrl: "./sign-in.html",
})
export class AppSignIn {
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
    const heading = "Your job application in the era of AI";
    // Under 155 characters, the length a result page shows whole; the h1 is not repeated.
    const description =
      "A tailored CV and cover letter for every job offer, built from one profile made of the CVs you already have. Let the silence stop.";
    const address = "https://job-application.app/";

    inject(Title).setTitle("AI CV builder for every job offer | job-application.app");
    const meta = inject(Meta);
    meta.updateTag({ name: "description", content: description });
    // What a pasted link unfurls as, in LinkedIn, Slack or a chat: the Open Graph tags
    // every unfurler reads, and the one Twitter card tag X does not take from them. No
    // `og:image` until there is an image: a tag naming one that is not there is cached
    // as a failure by some unfurlers.
    meta.updateTag({ property: "og:type", content: "website" });
    meta.updateTag({ property: "og:site_name", content: "job-application.app" });
    meta.updateTag({ property: "og:title", content: heading });
    meta.updateTag({ property: "og:description", content: description });
    meta.updateTag({ property: "og:url", content: address });
    meta.updateTag({ name: "twitter:card", content: "summary" });

    const document = inject(DOCUMENT);
    const canonical =
      document.head.querySelector<HTMLLinkElement>("link[rel=canonical]") ??
      document.head.appendChild(document.createElement("link"));
    canonical.rel = "canonical";
    canonical.href = address;
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
