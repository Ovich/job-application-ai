import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../hlm";

const TONE = {
  default: "text-foreground",
  danger: "text-danger",
} as const;
export type MenuItemTone = keyof typeof TONE;

/**
 * One row of a menu (ID98): full width, left aligned, shaded on hover, a `menuitem` of
 * type button. Not a variant of `hlmBtn`, because a menu row is another element: no
 * fill, no border, left aligned, and only ever inside a menu. `danger` is for the row
 * whose action cannot be undone.
 */
@Directive({
  selector: "button[uiMenuItem]",
  host: { role: "menuitem", type: "button", "[class]": "classes()" },
})
export class UiMenuItem {
  public readonly tone = input<MenuItemTone>("default");

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(
      "m-0 block w-full rounded-md px-3 py-2 text-left text-ui hover:bg-muted",
      TONE[this.tone()],
      this.userClass(),
    ),
  );
}
