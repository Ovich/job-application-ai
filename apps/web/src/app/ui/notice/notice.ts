import { Component, computed, input } from "@angular/core";
import { UiBox } from "../layout/box/box";
import { UiRow } from "../layout/row/row";
import { UiText } from "../typography/text/text";

type Tone = "ok" | "warn" | "danger";

const ROLE: Record<Tone, string> = { ok: "status", warn: "note", danger: "alert" };

/**
 * The glyph, in the tone's colour: a square as drawn, rounded for ok, clipped to a
 * triangle for warn. It holds no text, so its colour is its own fill, not a text tone.
 */
const GLYPH: Record<Tone, string> = {
  ok: "rounded-full bg-ok",
  warn: "[clip-path:polygon(50%_0,100%_100%,0_100%)] bg-warn",
  danger: "bg-danger",
};

const SURFACE: Record<Tone, "ok-soft" | "warn-soft" | "danger-soft"> = {
  ok: "ok-soft",
  warn: "warn-soft",
  danger: "danger-soft",
};

/**
 * One message above the content, in the tone it is in (ID82): its lead in the semibold
 * weight, then whatever the caller projects as its body. A danger notice is an alert, so
 * a screen reader announces it at once; an ok notice is a status, announced when the
 * reader is idle; a warn notice is a note, read in its place and never announced, since
 * it says what is so rather than what just happened (ID93). The glyph's shape carries
 * the meaning without the colour: a square for a failure, a round for a success, a
 * triangle for a warning.
 */
@Component({
  selector: "app-notice",
  imports: [UiRow, UiBox, UiText],
  templateUrl: "./notice.html",
  host: { "[attr.role]": "role()" },
})
export class AppNotice {
  public readonly tone = input.required<Tone>();

  public readonly lead = input.required<string>();

  protected readonly role = computed(() => ROLE[this.tone()]);

  protected readonly surface = computed(() => SURFACE[this.tone()]);

  protected readonly glyph = computed(() => GLYPH[this.tone()]);
}
