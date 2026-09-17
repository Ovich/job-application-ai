import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../../assistant/entry";
import { UiText } from "../../../../ui/typography/text/text";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/** A kind as a person reads it, as the API's read names it. */
const kindTitles: Record<string, string> = {
  summary: "Summary",
  identity: "Identity",
  experience: "Experience",
  project: "Projects",
  education: "Education",
  publication: "Publications",
  language: "Languages",
  group: "Groups",
  entry: "Entries",
};

/** A read as `lib/profile-edit` answers it, read defensively: a stored part is not re-parsed. */
type Read = { kind?: unknown; itemId?: unknown; items?: { title?: unknown }[] };

/**
 * A read of the profile, as the conversation draws it (`ID301`, D33): one quiet line
 * saying what was read, never the JSON the agent was handed. `Read your profile`,
 * `Read: Experience`, or `Read: <item title>`.
 *
 * No calls and no outputs: it reads the part it is given.
 */
@Component({
  selector: "history-read-part",
  imports: [UiText],
  templateUrl: "./history-read-part.html",
})
export class HistoryReadPart {
  public readonly part = input.required<Part>();

  protected readonly line = computed<string>(() => {
    const part = this.part();
    const read = (part.kind === "tool_result" ? part["read"] : undefined) as Read | undefined;
    if (typeof read !== "object" || read === null) return "Read your profile";
    if (typeof read.itemId === "string") {
      const title = read.items?.[0]?.title;
      return typeof title === "string" && title !== "" ? `Read: ${title}` : "Read an item";
    }
    if (typeof read.kind === "string") return `Read: ${kindTitles[read.kind] ?? read.kind}`;
    return "Read your profile";
  });
}
