import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../assistant/assistant-core";
import { UiText } from "../../../ui/typography/text/text";

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
  selector: "question-skipped-part",
  imports: [UiText],
  templateUrl: "./question-skipped-part.html",
})
export class QuestionSkippedPart {
  public readonly part = input.required<Part>();

  /** The question as it was asked. */
  protected readonly lead = computed(() => {
    const part = this.part();
    if (part.kind !== "question_skipped") return "";
    const lead = part["lead"];
    return typeof lead === "string" ? lead : "";
  });
}
