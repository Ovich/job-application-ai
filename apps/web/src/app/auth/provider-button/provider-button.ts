import { Component, computed, input, output } from "@angular/core";
import { HlmButton } from "../../ui/hlm-button";
import { ProviderMark, providerName } from "../provider-mark/provider-mark";
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
  imports: [HlmButton, ProviderMark],
  host: { class: "block" },
  templateUrl: "./provider-button.html",
})
export class ProviderButton {
  public readonly provider = input.required<Provider>();

  public readonly busy = input(false);

  public readonly disabled = input(false);

  public readonly pressed = output<void>();

  protected readonly name = computed(() => providerName[this.provider()]);

  /** Full width and the mockup's padding; busy is disabled against a second press but not dimmed. */
  protected readonly buttonClass = computed(() => [
    "h-auto w-full justify-start gap-3.5 px-4.5 py-3.5 text-body shadow-card",
    this.busy() ? "disabled:opacity-100" : "",
  ]);
}
