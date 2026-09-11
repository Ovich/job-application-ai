import {
  afterRenderEffect,
  Component,
  computed,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { AppAcknowledgeAction } from "../../ui/acknowledge-action/acknowledge-action";
import { HlmInput } from "../../ui/hlm-input";
import { UiBox } from "../../ui/layout/box/box";
import { UiStack } from "../../ui/layout/stack/stack";
import { AppNotice } from "../../ui/notice/notice";
import { UiText } from "../../ui/typography/text/text";
import { providerName } from "../provider-mark/provider-mark";
import type { Provider } from "../session";

/**
 * A–Z and 2–9 without O, 0, I and 1, the characters a person reads as each other.
 * Thirty-two of them, so a draw modulo the length is even across the alphabet.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight draws from the alphabet through the platform's random source. */
const newCode = (): string =>
  Array.from(
    crypto.getRandomValues(new Uint32Array(8)),
    (n) => ALPHABET[n % ALPHABET.length] ?? "",
  ).join("");

/**
 * Deleting the account, the business on the acknowledge gate (ID99, ID95, US5). Its first
 * step is the warning: what the deletion does, one line per linked provider in the order
 * linked, and the money callout, with Cancel and a primary Acknowledge. Acknowledged, the
 * warning stays, a new code of eight is drawn, and the phrase, the code and its field
 * appear above a red Delete account that stays disabled until what is typed, every space
 * removed and upper-cased, matches. No habit, no autofill and no misclick can carry it.
 *
 * It calls nothing: the providers, whether the deletion is running and whether it failed
 * come in, and the person's choice leaves as `confirm` or `cancel`; `CurrentUser` does the
 * deleting, through the shell. While it runs the code and the field give way to the
 * gate's working line; a failure puts the failure notice under the callout, the same
 * code and what was typed kept.
 */
@Component({
  selector: "app-delete-account",
  imports: [AppAcknowledgeAction, AppNotice, HlmInput, UiBox, UiStack, UiText],
  templateUrl: "./delete-account.html",
})
export class AppDeleteAccount {
  public readonly providers = input.required<Provider[]>();

  public readonly working = input(false);

  public readonly failed = input(false);

  public readonly confirm = output<void>();

  public readonly cancel = output<void>();

  protected readonly acknowledged = signal(false);

  /** Drawn at Acknowledge, and kept through `working` and after. */
  protected readonly code = signal("");

  protected readonly typed = signal("");

  protected readonly matches = computed(
    () => this.typed().replace(/\s/g, "").toUpperCase() === this.code(),
  );

  protected readonly fieldLabel = computed(() => `Type ${this.code()} to confirm`);

  protected readonly nameOf = (provider: Provider): string => providerName[provider];

  private readonly field = viewChild<ElementRef<HTMLInputElement>>("field");

  public constructor() {
    afterRenderEffect(() => {
      this.field()?.nativeElement.focus();
    });
  }

  /** The gate's one action: Acknowledge at the warning, Delete account after it. */
  protected act(): void {
    if (this.acknowledged()) {
      this.confirm.emit();
      return;
    }
    this.code.set(newCode());
    this.typed.set("");
    this.acknowledged.set(true);
  }

  protected onType(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.typed.set(event.target.value);
    }
  }
}
