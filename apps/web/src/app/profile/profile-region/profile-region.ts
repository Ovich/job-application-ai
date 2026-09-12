import { computed, Directive, input, output } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../ui/hlm";

/**
 * A region of the profile: an item, a line, a project or a chip, any of which a person
 * can point at and press (`US8`, `ID125`'s first rule).
 *
 * **The hover is CSS, and the selector is load-bearing.** Regions nest — a chip inside
 * a project inside a post — and the pointer is over all of them at once, so only the
 * innermost may light: `:hover:not(:has(.region:hover))`, written here as Tailwind's
 * `hover:not-has-[.region:hover]` variant. A `mouseenter` handler with
 * `stopPropagation` looks equivalent and is not: it breaks on a pointer that enters two
 * regions in one move. Nothing in this directive listens for a pointer.
 *
 * What a region is identified by is what it is and which row it is, and that is the
 * whole of `RegionRef`: the tool `SL4` binds to one never learns what a tool is from
 * here, and this directive never learns what opens on a press.
 */

/** Which row of which table a region stands for. The whole of what goes out. */
export type RegionRef = { kind: "item" | "line"; id: string };

const REGION = [
  "region cursor-pointer rounded-[var(--radius)]",
  "transition-[box-shadow,background-color] duration-150",
  "not-data-[selected=true]:hover:not-has-[.region:hover]:bg-accent",
  "not-data-[selected=true]:hover:not-has-[.region:hover]:shadow-[0_0_0_2px_var(--primary),0_0_0_6px_#1d4ed81f]",
].join(" ");

/**
 * The selected region, and only it: `relative` and a stacking context above the sheet's
 * overlay, which sits at `z-3`. Selecting a project must not light the post it hangs
 * under, which is `ID125`'s second rule, and a class on the one selected element is what
 * makes that true rather than a rule about ancestors.
 */
const SELECTED = [
  "relative z-[4] bg-card",
  "shadow-[0_0_0_2px_var(--primary),0_0_0_6px_#1d4ed81f]",
].join(" ");

@Directive({
  selector: "[profileRegion]",
  host: {
    "[class]": "classes()",
    "[attr.data-region]": "region().kind",
    "[attr.data-id]": "region().id",
    "[attr.data-selected]": "selected() ? 'true' : null",
    "(click)": "choose($event)",
  },
})
export class ProfileRegion {
  public readonly region = input.required<RegionRef>({ alias: "profileRegion" });

  /** Whether this is the one region a tool is open on (`ID125`, rule 2). */
  public readonly selected = input<boolean>(false);

  /** The region a person pressed. What opens on it is `SL4`'s. */
  public readonly select = output<RegionRef>();

  /**
   * The caller's own `class` arrives as an input and is merged here, as every primitive
   * in `ui/` does it: a `[class]` host binding and a static `class` attribute on the
   * same element would otherwise be two writers of one attribute.
   */
  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(REGION, this.selected() ? SELECTED : "", this.userClass()),
  );

  /**
   * The press, stopped here. Regions nest, so a click on a chip would otherwise reach
   * the project and the post above it and say three things where a person said one.
   */
  protected choose(event: Event): void {
    event.stopPropagation();
    this.select.emit(this.region());
  }
}
