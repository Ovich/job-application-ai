import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from "@angular/core";
import { HlmBtn } from "../hlm-button";
import { UiBox } from "../layout/box/box";
import { UiRow } from "../layout/row/row";
import { UiStack } from "../layout/stack/stack";
import { UiSpinner } from "../spinner/spinner";
import { UiText } from "../typography/text/text";

/** Each gate's title its own id, so the panel can be labelled by it. */
let opened = 0;

/**
 * The one acknowledge gate for every consequential action (ID99, amending ID89 and ID95),
 * after roster's: a panel holding the title, the caller's body, then Cancel and one
 * action. What the action says, whether it is red and whether it is live are the
 * caller's inputs, so a gate with steps of its own, like deleting the account
 * (`auth/delete-account`), is a caller that changes them; nothing of one action's
 * business lives here. Where it sits is its host's; the caller creates it to open it and
 * destroys it to close it (ID94's controlled mode).
 *
 * `working` is the caller's action running: the working line and a spinner replace the
 * buttons, and nothing leaves until it ends. Cancel, Escape and a press outside leave as
 * `cancel`, never while working; `action` leaves only while live. The panel is a dialog
 * labelled by its title, and its action takes the focus when it opens, so the focus is
 * inside it; a caller with a field of its own moves it there.
 */
@Component({
  selector: "app-acknowledge-action",
  imports: [HlmBtn, UiBox, UiRow, UiSpinner, UiStack, UiText],
  host: {
    class: "block",
    "(document:click)": "cancelUnless($event)",
    "(document:keydown.escape)": "dismiss()",
  },
  templateUrl: "./acknowledge-action.html",
})
export class AppAcknowledgeAction {
  public readonly title = input.required<string>();

  public readonly actionLabel = input.required<string>();

  public readonly destructive = input(false);

  public readonly disabled = input(false);

  public readonly working = input(false);

  public readonly workingLabel = input("");

  public readonly action = output<void>();

  public readonly cancel = output<void>();

  protected readonly titleId = `acknowledge-action-title-${++opened}`;

  private readonly actionButton = viewChild<ElementRef<HTMLButtonElement>>("actionButton");

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  public constructor() {
    afterNextRender(() => {
      this.actionButton()?.nativeElement.focus();
    });
  }

  protected press(): void {
    if (!this.disabled() && !this.working()) {
      this.action.emit();
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
