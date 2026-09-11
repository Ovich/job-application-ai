import { Component, computed, input, output } from "@angular/core";
import { HlmButton } from "../ui/hlm-button";
import { ProviderMark, providerName } from "./provider-mark";
import type { Provider } from "./session";

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
  template: `
    <button
      hlmBtn
      variant="secondary"
      type="button"
      [class]="buttonClass()"
      [disabled]="disabled() || busy()"
      [attr.aria-busy]="busy() ? 'true' : null"
      (click)="pressed.emit()"
    >
      <app-provider-mark [provider]="provider()" />
      <span>Continue with {{ name() }}</span>
      @if (busy()) {
        <span
          class="ml-auto size-4 animate-spin rounded-full border-2 border-border border-t-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        ></span>
      } @else if (!disabled()) {
        <svg viewBox="0 0 16 16" class="ml-auto size-4 text-muted-foreground" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      }
    </button>
  `,
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
