import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { MARGIN_Y, type Pad } from "../tokens";

/**
 * A divider (ID97), on a native `<hr>` so a screen reader still announces a separator:
 * the border token, and its space above and below from the spacing scale. Horizontal
 * only; a vertical one gets an input when a screen first draws it.
 */
@Directive({
  selector: "[uiSeparator]",
  host: { "[class]": "classes()" },
})
export class UiSeparator {
  public readonly space = input<Pad>("xs");

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm("border-border", MARGIN_Y[this.space()], this.userClass()),
  );
}
