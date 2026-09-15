import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../../assistant/entry";
import { UiText } from "../../../../ui/typography/text/text";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/**
 * A question the person put off, as the conversation draws it (agent-consolidation
 * `S7.3`, `ID191`, spec `H26`): on the person's side, one short line saying which
 * question was skipped.
 *
 * No calls and no outputs: it reads the part it is given.
 */
@Component({
  selector: "history-skip-part",
  imports: [UiText],
  templateUrl: "./history-skip-part.html",
})
export class HistorySkipPart {
  public readonly part = input.required<Part>();

  /** Where the question sits in the profile (`S7.6`). */
  protected readonly where = computed(() => {
    const part = this.part();
    if (part.kind !== "question_skipped") return "";
    const where = part["where"];
    return typeof where === "string" ? where : "";
  });

  /** The question as it was asked. */
  protected readonly lead = computed(() => {
    const part = this.part();
    if (part.kind !== "question_skipped") return "";
    const lead = part["lead"];
    return typeof lead === "string" ? lead : "";
  });
}
