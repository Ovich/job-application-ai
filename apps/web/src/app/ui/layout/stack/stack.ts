import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { ALIGN, type Align, GAP, type Gap, JUSTIFY, type Justify } from "../tokens";

/**
 * A vertical column with a gap from the scale (ID81), on whatever element the caller
 * chose, so a `main` stays a `main`. The host's classes are its whole seam; the
 * caller's own `class` merges through `hlm()`, so a utility written there wins.
 */
@Directive({
  selector: "[uiStack]",
  host: { "[class]": "classes()" },
})
export class UiStack {
  public readonly gap = input<Gap>("md");

  public readonly align = input<Align>();

  public readonly justify = input<Justify>();

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() => {
    const align = this.align();
    const justify = this.justify();
    return hlm(
      "flex flex-col",
      GAP[this.gap()],
      align && ALIGN[align],
      justify && JUSTIFY[justify],
      this.userClass(),
    );
  });
}
