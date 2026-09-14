import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../assistant/assistant-core";
import { UiText } from "../../../ui/typography/text/text";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/**
 * A question the person answered with the assistant's tool, as the conversation draws it
 * (agent-consolidation `S7.3`, `ID191`, spec `H26`): on the person's side, the option
 * they picked and their words beside it, as their own bubble.
 *
 * No calls and no outputs: it reads the part it is given, defensively, since a stored
 * part is not parsed again on the way to the screen.
 */
@Component({
  selector: "question-answered-part",
  imports: [UiText],
  templateUrl: "./question-answered-part.html",
})
export class QuestionAnsweredPart {
  public readonly part = input.required<Part>();

  /** The label of the option picked, or nothing when the person answered in words alone. */
  protected readonly picked = computed(() => {
    const part = this.part();
    if (part.kind !== "question_answered") return null;
    const options = Array.isArray(part["options"])
      ? (part["options"] as { id?: unknown; label?: unknown }[])
      : [];
    const label = options.find((option) => option.id === part["picked"])?.label;
    return typeof label === "string" ? label : null;
  });

  /** The person's own words, or nothing. */
  protected readonly words = computed(() => {
    const part = this.part();
    if (part.kind !== "question_answered") return null;
    const words = part["words"];
    return typeof words === "string" && words !== "" ? words : null;
  });
}
