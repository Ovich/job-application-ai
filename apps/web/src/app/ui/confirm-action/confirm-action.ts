import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { HlmBtn } from "../hlm-button";
import { UiBox } from "../layout/box/box";
import { UiRow } from "../layout/row/row";
import { UiStack } from "../layout/stack/stack";
import { UiText } from "../typography/text/text";

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

/** Each gate's title its own id, so the panel can be labelled by it. */
let opened = 0;

/**
 * The one confirm gate for every consequential action (ID89), after roster's: a panel
 * holding the title, the caller's body, then Cancel and the action. Where it sits is its
 * host's, as the account menu's place is the bar's; the caller creates it to open it and
 * destroys it to close it (ID94's controlled mode), so each opening is a new gate.
 *
 * With `code` on it is the destructive gate, in two steps (ID95). First the warning
 * alone, the caller's body with Cancel and a primary Acknowledge. Acknowledged, the
 * warning stays and eight characters are drawn, shown large and monospaced on one line,
 * with a field that must match them, typed in any case and with any spaces, before the
 * red action arms. No habit, no autofill and no misclick can carry it. Without a code
 * the gate is one step: the body, Cancel and the primary action, live.
 *
 * The focus goes into the panel when it opens, to Acknowledge, and to the field once it
 * is there: Acknowledge only reveals the code, so a stray Enter on it deletes nothing.
 *
 * `working` is the caller's action running: the working line replaces the phrase, the
 * code, the field and the buttons, and nothing leaves until it ends, when the gate is as
 * it was, the same code and what was typed with it. Cancel, Escape and a press outside
 * leave as `cancel`, never while working; `confirm` leaves only while armed.
 */
@Component({
  selector: "app-confirm-action",
  imports: [HlmBtn, UiBox, UiRow, UiStack, UiText],
  host: {
    class: "block",
    "(document:click)": "cancelUnless($event)",
    "(document:keydown.escape)": "dismiss()",
  },
  templateUrl: "./confirm-action.html",
})
export class AppConfirmAction {
  public readonly title = input.required<string>();

  public readonly confirmLabel = input.required<string>();

  public readonly code = input(false);

  public readonly working = input(false);

  public readonly workingLabel = input("");

  public readonly confirm = output<void>();

  public readonly cancel = output<void>();

  protected readonly titleId = `confirm-action-title-${++opened}`;

  /** Whether Acknowledge has been pressed; the gate is created unacknowledged. */
  protected readonly acknowledged = signal(false);

  /** The first step: the destructive gate, not yet acknowledged. */
  protected readonly warning = computed(() => this.code() && !this.acknowledged());

  /** Drawn at Acknowledge, and kept through `working` and after. */
  protected readonly shown = signal("");

  protected readonly typed = signal("");

  protected readonly armed = computed(
    () => !this.code() || this.typed().replace(/\s/g, "").toUpperCase() === this.shown(),
  );

  private readonly field = viewChild<ElementRef<HTMLInputElement>>("field");

  private readonly acknowledgement = viewChild<ElementRef<HTMLButtonElement>>("acknowledgement");

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  public constructor() {
    afterRenderEffect(() => {
      (this.field() ?? this.acknowledgement())?.nativeElement.focus();
    });
  }

  protected acknowledge(): void {
    this.shown.set(newCode());
    this.typed.set("");
    this.acknowledged.set(true);
  }

  protected onType(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.typed.set(event.target.value);
    }
  }

  protected press(): void {
    if (this.armed() && !this.working()) {
      this.confirm.emit();
    }
  }

  protected dismiss(): void {
    if (!this.working()) {
      this.cancel.emit();
    }
  }

  /** A press anywhere but on the gate itself is a cancel. */
  protected cancelUnless(event: Event): void {
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) {
      return;
    }
    this.dismiss();
  }
}
