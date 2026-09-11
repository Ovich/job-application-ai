import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../hlm";

const ARC = {
  primary: "border-t-primary",
  danger: "border-t-danger",
} as const;
export type SpinnerTone = keyof typeof ARC;

/**
 * The loader (ID99): a ring turning beside the line that says what is running, its arc
 * in the tone of the work (`danger` for a deletion). It says nothing itself, so it is
 * hidden from a screen reader, and it holds still under reduced motion, where the colour
 * of its arc alone says it is working.
 */
@Directive({
  selector: "[uiSpinner]",
  host: { "aria-hidden": "true", "[class]": "classes()" },
})
export class UiSpinner {
  public readonly tone = input<SpinnerTone>("primary");

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(
      "inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-border motion-reduce:animate-none",
      ARC[this.tone()],
      this.userClass(),
    ),
  );
}
