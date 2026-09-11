import { NgTemplateOutlet } from "@angular/common";
import { Component, computed, ElementRef, inject, input, output, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { SignedIn } from "../../auth/session";
import { Wordmark } from "../wordmark/wordmark";
import { AccountMenu } from "./account-menu/account-menu";

/**
 * The AppBar (ID64), first drawn here: the wordmark, the nav, the CreditMeter and the
 * account slot. The user comes in as an input, so the bar can be tested by state
 * without the network and its seam is its own; what the person does leaves as outputs,
 * and the shell decides what follows.
 *
 * In this slot the nav's Applications and Credits and the CreditMeter are drawn inert,
 * placeholders for the slots that feed them (F3): Profile is the one route there is.
 * The slot is the bar's own initials button rather than a component of its own, because
 * a component that only forwards its parent's input and outputs fails the deletion test.
 * The bar owns whether the menu is open; Escape and a press outside close it, and so do
 * the menu's own outputs.
 */
@Component({
  selector: "app-app-bar",
  imports: [NgTemplateOutlet, RouterLink, Wordmark, AccountMenu],
  host: {
    class:
      "flex h-[60px] shrink-0 items-center gap-2.5 border-b border-border bg-card px-3.5 sm:gap-5 sm:px-5",
    "(document:click)": "closeUnless($event)",
    "(document:keydown.escape)": "close()",
  },
  templateUrl: "./app-bar.html",
})
export class AppBar {
  public readonly user = input.required<SignedIn>();

  public readonly signOut = output<void>();

  /** SL4 listens; nobody in this slice. */
  public readonly deleteAccount = output<void>();

  protected readonly menuOpen = signal(false);

  /** The first letters of the name's first two words, upper case. */
  protected readonly initials = computed(() =>
    this.user()
      .name.split(/\s+/)
      .filter((word) => word.length > 0)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join(""),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(): void {
    this.menuOpen.update((open) => !open);
  }

  protected close(): void {
    this.menuOpen.set(false);
  }

  /** A press anywhere but on the bar's own account slot or its menu closes the menu. */
  protected closeUnless(event: Event): void {
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) {
      return;
    }
    this.close();
  }

  /** The menu's output leaves as the bar's, and the menu closes. */
  protected forward(out: { emit: () => void }): void {
    this.close();
    out.emit();
  }
}
