import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { GAP } from "../tokens";

/**
 * The column under the AppBar (ID81): it fills the height left, opens with one step of
 * air, and spaces its blocks by the lg gap. One rule for every signed-in page.
 */
@Directive({
  selector: "[uiPage]",
  host: { "[class]": "classes()" },
})
export class UiPage {
  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm("flex flex-1 flex-col pt-6", GAP.lg, this.userClass()),
  );
}
