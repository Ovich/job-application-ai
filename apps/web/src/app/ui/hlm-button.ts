import { computed, Directive, input } from "@angular/core";
import { BrnButton } from "@spartan-ng/brain/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ClassValue } from "clsx";
import { hlm } from "./hlm";

/**
 * The button's look, as a variant table rather than a class string per call site. This
 * is the one folder rule 16 exempts, so the utilities live here and nowhere else: a
 * page names a variant and a size, and never a colour.
 *
 * Adapted from spartan/ui 1.4.1's `hlm-button`. Two departures, both deliberate:
 *
 * - The variant and size names are the design language's (primary, secondary, ghost,
 *   destructive; sm and md), not spartan's own (default, outline, link; xs to lg and
 *   the icon sizes). The document's component table is what a caller reads, and a
 *   button this product has no design for is better absent than half-defined.
 * - Upstream 1.4 emits `spartan-button-variant-*` marker classes whose meaning lives
 *   in one of spartan's own theme stylesheets. Importing one would be a second palette
 *   beside the tokens this app already declares, so the utilities are written out here
 *   against those tokens instead, which is the form helm had before that refactor.
 *
 * The behaviour is spartan's, unchanged: `BrnButton` runs as a host directive, so it
 * keeps `disabled` reflected to the attribute, the tab stop removed, and a disabled
 * anchor's click swallowed.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        // There is no `--danger-foreground` token, so the label borrows the primary's,
        // which is white while the product designs light only. Revisit when dark ships
        // (ID28): white on red is right there too, and this token is not.
        destructive: "bg-danger text-primary-foreground hover:bg-danger/90",
      },
      size: {
        // The design language's control sizes: 16 px for a button, 15 px for a control.
        md: "h-10 px-4 text-ui",
        sm: "h-8 px-3 text-caption",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: "button[hlmBtn], a[hlmBtn]",
  exportAs: "hlmBtn",
  hostDirectives: [{ directive: BrnButton, inputs: ["disabled"] }],
  host: { "data-slot": "button", "[class]": "_computedClass()" },
})
export class HlmButton {
  public readonly variant = input<ButtonVariants["variant"]>("primary");

  public readonly size = input<ButtonVariants["size"]>("md");

  /**
   * Whatever the call site wrote in `class`. The host binding below replaces the
   * attribute, so it is read back as an input and merged rather than lost, and
   * `tailwind-merge` decides which of two conflicting utilities survives.
   */
  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly _computedClass = computed(() =>
    hlm(buttonVariants({ variant: this.variant(), size: this.size() }), this.userClass()),
  );
}
