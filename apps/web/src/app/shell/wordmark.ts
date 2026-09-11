import { Component } from "@angular/core";

/**
 * The mark and the name (ID76), used by the entry route and the AppBar. The mark is the
 * design language's (settled 2026-09-11): the wordmark reduced to its shape, a white dot
 * then a white pill on the one blue, on a 512 grid with the tile's corners at 80. It
 * keeps its colours in both themes, because a logo is the same object everywhere, so
 * the blue is written here and not read from a token. Then `job-application` in the
 * foreground weight and `.app` muted at 400, so the domain reads as a name rather than
 * as a URL (F5).
 */
@Component({
  selector: "app-wordmark",
  host: { class: "inline-flex items-center gap-2.5 font-semibold" },
  template: `
    <svg viewBox="0 0 512 512" class="size-6 shrink-0" aria-hidden="true">
      <rect width="512" height="512" rx="80" fill="#1d4ed8" />
      <circle cx="150" cy="256" r="50" fill="#ffffff" />
      <rect x="230" y="216" width="176" height="80" rx="40" fill="#ffffff" />
    </svg>
    <span>job-application<span class="font-normal text-muted-foreground">.app</span></span>
  `,
})
export class Wordmark {}
