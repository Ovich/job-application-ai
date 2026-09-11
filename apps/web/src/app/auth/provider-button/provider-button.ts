import { Component, computed, input, output } from "@angular/core";
import { HlmBtn } from "../../ui/hlm-button";
import { UiText } from "../../ui/typography/text/text";
import { AppProviderMark, providerName } from "../provider-mark/provider-mark";
import type { Provider } from "../session";

/**
 * One provider's door: full width, the mark, the verb, a chevron. "Continue with", not
 * "Sign in with", because for a first-time person there is nothing yet to sign in to.
 *
 * Busy replaces the chevron with a spinner, because the browser is about to leave for
 * the provider; the parent disables the other two. It calls nothing: the parent asks
 * the library, and what this emits is the press.
 */
@Component({
  selector: "app-provider-button",
  imports: [HlmBtn, AppProviderMark, UiText],
  host: { class: "block" },
  templateUrl: "./provider-button.html",
})
export class AppProviderButton {
  public readonly provider = input.required<Provider>();

  public readonly busy = input(false);

  public readonly disabled = input(false);

  public readonly pressed = output<void>();

  protected readonly name = computed(() => providerName[this.provider()]);

  /** Full width, left aligned, lifted; busy is disabled against a second press but not dimmed. */
  protected readonly buttonClass = computed(() => [
    "w-full justify-start shadow-card",
    this.busy() ? "disabled:opacity-100" : "",
  ]);
}
