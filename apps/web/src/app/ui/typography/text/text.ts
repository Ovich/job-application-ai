import { computed, Directive, input } from "@angular/core";
import type { ClassValue } from "clsx";
import { hlm } from "../../hlm";

/**
 * The one typography directive (ID81), on the element the caller chose so an `h1`
 * stays an `h1` and a `p` a `p`. The variants are the app's own type scale as
 * `styles.css` declares it, one name per role; the tones are the language's text
 * colours; the two weights are the only two it allows. Margins are zeroed, so the
 * layout's gap alone spaces text.
 */

const VARIANT = {
  label: "text-label",
  caption: "text-caption",
  ui: "text-ui",
  body: "text-body",
  figure: "text-figure",
} as const;
export type Variant = keyof typeof VARIANT;

const TONE = {
  foreground: "text-foreground",
  muted: "text-muted-foreground",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
} as const;
export type Tone = keyof typeof TONE;

const WEIGHT = {
  regular: "font-normal",
  semibold: "font-semibold",
} as const;
export type Weight = keyof typeof WEIGHT;

const TEXT_ALIGN = {
  start: "text-left",
  center: "text-center",
} as const;
export type TextAlign = keyof typeof TEXT_ALIGN;

@Directive({
  selector: "[uiText]",
  host: { "[class]": "classes()" },
})
export class UiText {
  public readonly variant = input<Variant>("body");

  public readonly tone = input<Tone>("foreground");

  public readonly weight = input<Weight>();

  public readonly align = input<TextAlign>();

  public readonly userClass = input<ClassValue>("", { alias: "class" });

  protected readonly classes = computed(() => {
    const weight = this.weight();
    const align = this.align();
    return hlm(
      "m-0",
      VARIANT[this.variant()],
      TONE[this.tone()],
      weight && WEIGHT[weight],
      align && TEXT_ALIGN[align],
      this.userClass(),
    );
  });
}
