import { Component, input } from "@angular/core";
import type { Provider } from "./session";

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
  template: `
    @switch (provider()) {
      @case ("google") {
        <svg viewBox="0 0 48 48" [class]="sizeClass()" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.4z" />
          <path fill="#FBBC05" d="M10.3 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l7.8-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.8-3.7-13.7-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
      }
      @case ("microsoft") {
        <svg viewBox="0 0 23 23" [class]="sizeClass()" aria-hidden="true">
          <path fill="#F25022" d="M1 1h10v10H1z" />
          <path fill="#7FBA00" d="M12 1h10v10H12z" />
          <path fill="#00A4EF" d="M1 12h10v10H1z" />
          <path fill="#FFB900" d="M12 12h10v10H12z" />
        </svg>
      }
      @case ("linkedin") {
        <svg viewBox="0 0 24 24" [class]="sizeClass()" aria-hidden="true">
          <path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      }
    }
  `,
})
export class ProviderMark {
  public readonly provider = input.required<Provider>();

  /** The mark's box: 22 px on a button, 14 px on the menu's line. */
  public readonly sizeClass = input<string>("size-[22px]");
}
