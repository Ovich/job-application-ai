import { booleanAttribute, computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { PAD, PAD_X, PAD_Y, type Pad, RADIUS, type Radius, SURFACE, type Surface } from "../tokens";

/**
 * A block with a surface (ID81): padding from the scale, on all sides or per axis, a
 * surface token, a radius, a border. Nothing about how its children lay out, which is
 * a stack's or a row's, and the two compose on one element.
 */
@Directive({
  selector: "[uiBox]",
  host: { "[class]": "classes()" },
})
export class UiBox {
  public readonly p = input<Pad>();

  public readonly px = input<Pad>();

  public readonly py = input<Pad>();

  public readonly surface = input<Surface>();

  public readonly radius = input<Radius>();

  public readonly border = input(false, { transform: booleanAttribute });

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() => {
    const p = this.p();
    const px = this.px();
    const py = this.py();
    const surface = this.surface();
    const radius = this.radius();
    return hlm(
      p && PAD[p],
      px && PAD_X[px],
      py && PAD_Y[py],
      surface && SURFACE[surface],
      radius && RADIUS[radius],
      this.border() && "border border-border",
      this.userClass(),
    );
  });
}
