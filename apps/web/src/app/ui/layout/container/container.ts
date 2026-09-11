import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";
import { WIDTH, type Width } from "../tokens";

/** A centred content column (ID81) at one of three widths, with responsive side padding. */
@Directive({
  selector: "[uiContainer]",
  host: { "[class]": "classes()" },
})
export class UiContainer {
  public readonly width = input<Width>("md");

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm("mx-auto w-full px-4 sm:px-6", WIDTH[this.width()], this.userClass()),
  );
}
