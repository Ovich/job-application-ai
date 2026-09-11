import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "./hlm";

/**
 * The text field's look (ID99), beside `hlmBtn` and in the same folder, so the
 * utilities live here and a page names none: full width, the input token's border on
 * the card surface, the control's size from the type scale, and the focus ring the
 * buttons carry. A caller's own `class` merges in through `hlm()`, so a field that
 * needs a monospaced, upper-case face adds it without restating the rest.
 *
 * Styling only: the field stays a native `<input>`, its value, its events and its
 * attributes the caller's.
 */
@Directive({
  selector: "input[hlmInput]",
  host: { "data-slot": "input", "[class]": "classes()" },
})
export class HlmInput {
  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(
      "w-full rounded-md border border-input bg-card px-3 py-2 text-ui text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary",
      this.userClass(),
    ),
  );
}
