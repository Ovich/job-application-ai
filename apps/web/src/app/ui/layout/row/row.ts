import { booleanAttribute, computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { ALIGN, type Align, GAP, type Gap, JUSTIFY, type Justify } from "../tokens";

/** A horizontal row (ID81): items centred unless said otherwise, a gap from the scale, wrap on request. */
@Directive({
  selector: "[uiRow]",
  host: { "[class]": "classes()" },
})
export class UiRow {
  public readonly gap = input<Gap>("md");

  public readonly align = input<Align>("center");

  public readonly justify = input<Justify>();

  public readonly wrap = input(false, { transform: booleanAttribute });

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() => {
    const justify = this.justify();
    return hlm(
      "flex flex-row",
      this.wrap() && "flex-wrap",
      GAP[this.gap()],
      ALIGN[this.align()],
      justify && JUSTIFY[justify],
      this.userClass(),
    );
  });
}
