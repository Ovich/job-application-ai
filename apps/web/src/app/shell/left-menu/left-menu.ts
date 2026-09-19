import {
  afterRenderEffect,
  Component,
  type ElementRef,
  input,
  output,
  viewChild,
} from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import type { SignedIn } from "../../auth/session";
import { UiBox } from "../../ui/layout/box/box";
import { UiRow } from "../../ui/layout/row/row";
import { UiSpacer } from "../../ui/layout/spacer/spacer";
import { UiStack } from "../../ui/layout/stack/stack";
import { UiText } from "../../ui/typography/text/text";
import { AppAccountMenu } from "../app-bar/account-menu/account-menu";
import { AppWordmark } from "../wordmark/wordmark";

/**
 * What the AppBar held, moved under the menu square (D20): the wordmark, the nav — Home,
 * Profile, and Applications and Credits still inert with the meter's figure — and the
 * account at the foot, which is `AppAccountMenu` unchanged rather than a second copy of
 * the same rows.
 *
 * **It owns the panel's behaviour and nothing else.** The scrim, the focus trap and
 * Escape live here, so a caller opens it with one boolean and listens; what the person
 * asks for leaves as an output and the shell decides what follows. The person comes in as
 * an input and no service is reached from the template (`AGENTS.md` rule 3).
 *
 * Focus goes to the panel's own close square when it opens and stays inside the panel
 * while it is open; where it goes when the panel closes is the shell's, because the
 * element it returns to is the shell's square.
 */
@Component({
  selector: "left-menu",
  imports: [
    RouterLink,
    RouterLinkActive,
    AppAccountMenu,
    AppWordmark,
    UiBox,
    UiRow,
    UiSpacer,
    UiStack,
    UiText,
  ],
  host: {
    class: "contents",
    "(document:keydown.escape)": "escaped()",
  },
  templateUrl: "./left-menu.html",
})
export class LeftMenu {
  public readonly open = input<boolean>(false);

  public readonly user = input<SignedIn | null>(null);

  public readonly close = output<void>();

  public readonly signOut = output<void>();

  public readonly deleteAccount = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>("panel");

  private readonly closeSquare = viewChild<ElementRef<HTMLButtonElement>>("closeSquare");

  public constructor() {
    // The focus lands on the close square the moment the panel is drawn, so the first Tab
    // walks the menu rather than the page behind it.
    afterRenderEffect(() => {
      if (this.open()) {
        this.closeSquare()?.nativeElement.focus({ preventScroll: true });
      }
    });
  }

  protected escaped(): void {
    if (this.open()) {
      this.close.emit();
    }
  }

  /**
   * The trap: Tab off the last thing in the panel comes back to the first, and Shift+Tab
   * off the first goes to the last. A panel over a scrim that a Tab can walk out of is a
   * panel a keyboard cannot tell is there.
   */
  protected trap(event: Event): void {
    const panel = this.panel()?.nativeElement;
    if (!(event instanceof KeyboardEvent) || event.key !== "Tab" || panel === undefined) {
      return;
    }
    const stops = Array.from(
      panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]"),
    ).filter((element) => element.tabIndex >= 0);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const on = document.activeElement;
    if (event.shiftKey && on === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && on === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
