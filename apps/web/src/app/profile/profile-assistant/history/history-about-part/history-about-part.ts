import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../../assistant/entry";
import { UiText } from "../../../../ui/typography/text/text";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/**
 * What the person's words are about, as the conversation draws it (agent-consolidation
 * `S8.7`, `ID233`): the item's where, composed by the API, above the person's bubble.
 *
 * No calls and no outputs: it reads the part it is given, defensively, since a stored
 * part is not parsed again on the way to the screen.
 */
@Component({
  selector: "history-about-part",
  imports: [UiText],
  templateUrl: "./history-about-part.html",
})
export class HistoryAboutPart {
  public readonly part = input.required<Part>();

  /** Where the words are: an item's title, or `<title> · row <n>` for a line. */
  protected readonly where = computed(() => {
    const part = this.part();
    if (part.kind !== "about") return "";
    const where = part["where"];
    return typeof where === "string" ? where : "";
  });
}
