import { Component, type ElementRef, input, output, viewChild } from "@angular/core";

/**
 * The square that opens the left menu (D20), drawn where the AppBar began: as tall as
 * whatever bar sits beside it, 64 px wide above a phone and 56 on one, the border on its
 * right the only thing between the two.
 *
 * Its only state is whether the menu is expanded, which the shell holds and hands back as
 * an input, so the square draws the bars or the cross and says so to a screen reader. It
 * has no visible label: the accessible name is "Menu" and the icon carries the rest.
 *
 * `focus()` exists because Escape has to put the focus back where it came from, and where
 * it came from is inside here: the shell says when, the square knows on what.
 */
@Component({
  selector: "menu-button",
  host: { class: "contents" },
  templateUrl: "./menu-button.html",
})
export class MenuButton {
  public readonly expanded = input<boolean>(false);

  public readonly toggle = output<void>();

  private readonly square = viewChild.required<ElementRef<HTMLButtonElement>>("square");

  /** Puts the focus back on the square, after the menu it opened has closed. */
  public focus(): void {
    this.square().nativeElement.focus({ preventScroll: true });
  }
}
