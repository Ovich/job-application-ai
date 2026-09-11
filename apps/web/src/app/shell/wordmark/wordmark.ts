import { Component } from "@angular/core";
import { UiRow } from "../../ui/layout/row/row";
import { UiText } from "../../ui/typography/text/text";

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
  imports: [UiRow, UiText],
  templateUrl: "./wordmark.html",
})
export class AppWordmark {}
