import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { GAP } from "../tokens";

/**
 * The column under the AppBar (ID81): it fills the height left, opens with one step of
 * air, and spaces its blocks by the lg gap. One rule for every signed-in page.
 *
 * **It is the page that scrolls, never the window** (the person, 2026-09-12). The shell
 * is exactly the viewport's height, so the bar stays where it is and a long screen
 * scrolls under it. A screen that fills the height and scrolls inside itself — every
 * assistant layout does — takes `h-full` and overflows nothing here.
 */
@Directive({
  selector: "[uiPage]",
  host: { "[class]": "classes()" },
})
export class UiPage {
  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm("flex min-h-0 flex-1 flex-col overflow-y-auto pt-6", GAP.lg, this.userClass()),
  );
}
