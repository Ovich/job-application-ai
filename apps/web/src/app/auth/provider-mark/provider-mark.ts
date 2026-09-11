import { Component, input } from "@angular/core";
import type { Provider } from "../session";

/** How each provider is named to the person, on a button and in the account menu. */
export const providerName: Record<Provider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
};

/**
 * A provider's own mark, in its brand colours: the one deviation from the language's
 * single blue, flagged by the mockup and kept, because a Google button without Google's
 * G reads as a fake sign-in. Drawn once here for the provider buttons and the account
 * menu's providers line. Decorative: the text beside it carries the name.
 */
@Component({
  selector: "app-provider-mark",
  host: { class: "inline-flex shrink-0" },
  templateUrl: "./provider-mark.html",
})
export class ProviderMark {
  public readonly provider = input.required<Provider>();

  /** The mark's box: 22 px on a button, 14 px on the menu's line. */
  public readonly sizeClass = input<string>("size-[22px]");
}
