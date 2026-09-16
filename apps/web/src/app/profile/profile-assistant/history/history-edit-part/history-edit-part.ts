import { Component, computed, input } from "@angular/core";
import type { Entry } from "../../../../assistant/entry";
import { UiText } from "../../../../ui/typography/text/text";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/** One thing the edit changed: where, what it was, and what it is now. */
type Change = { where: string; was: string | null; now: string | null };

/** What the part draws: the changes to one item, or why the edit was refused. */
type Drawn =
  { kind: "applied"; item: string; changes: Change[] } | { kind: "refused"; reason: string };

/** An item as `lib/profile-edit` answers it, read defensively: a stored part is not re-parsed. */
type Item = {
  title?: unknown;
  lines?: { id: string; text: string }[];
  children?: { id: string; title: string }[];
  block?: Record<string, unknown> | null;
  [field: string]: unknown;
};

/** The fields a person reads, in their order, by the words the sheet uses for them. */
const fields: [key: string, name: string][] = [
  ["title", "title"],
  ["subtitle", "subtitle"],
  ["startText", "start"],
  ["endText", "end"],
];

const blockNames: Record<string, string> = {
  organisation: "organisation",
  organisationNote: "organisation note",
  location: "location",
  arrangement: "arrangement",
  description: "description",
  datesText: "dates",
  institution: "institution",
  credential: "credential",
  note: "note",
  label: "label",
  qualifier: "qualifier",
};

const wordsOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** Every change from one item to the other, in the order the sheet draws them. */
const changesOf = (before: Item, after: Item): Change[] => {
  const changes: Change[] = [];
  for (const [key, name] of fields) {
    if (before[key] !== after[key]) {
      changes.push({ where: name, was: wordsOf(before[key]), now: wordsOf(after[key]) });
    }
  }
  const was = before.block ?? {};
  const now = after.block ?? {};
  for (const key of Object.keys({ ...was, ...now })) {
    if (was[key] !== now[key]) {
      changes.push({
        where: blockNames[key] ?? key,
        was: wordsOf(was[key]),
        now: wordsOf(now[key]),
      });
    }
  }

  const earlier = before.lines ?? [];
  const later = after.lines ?? [];
  for (const [at, line] of earlier.entries()) {
    if (!later.some((each) => each.id === line.id)) {
      changes.push({ where: `line ${at + 1}, removed`, was: line.text, now: null });
    }
  }
  for (const [at, line] of later.entries()) {
    const was = earlier.find((each) => each.id === line.id);
    if (was === undefined) {
      changes.push({ where: `line ${at + 1}, added`, was: null, now: line.text });
    } else if (was.text !== line.text) {
      changes.push({ where: `line ${at + 1}`, was: was.text, now: line.text });
    }
  }

  const kept = after.children ?? [];
  for (const child of before.children ?? []) {
    if (!kept.some((each) => each.id === child.id)) {
      changes.push({ where: "removed from it", was: child.title, now: null });
    }
  }
  return changes;
};

/**
 * The profile edit, as the conversation draws it (`S4.6`, `ID185`, `ID191`, the
 * components library's `.record`, `H1`): under the item's name, each change's before
 * struck through and its after in green; or, when the edit was refused, the reason, and
 * no before and after.
 *
 * Provided for both of the edit's parts: a `tool_result` is drawn, and a `tool_use` is
 * drawn as nothing, because the record that follows it says what the call did.
 *
 * No calls and no outputs: it reads the part it is given.
 */
@Component({
  selector: "history-edit-part",
  imports: [UiText],
  templateUrl: "./history-edit-part.html",
})
export class HistoryEditPart {
  public readonly part = input.required<Part>();

  protected readonly drawn = computed<Drawn | null>(() => {
    const part = this.part();
    if (part.kind !== "tool_result") return null;
    if (typeof part["refused"] === "string") return { kind: "refused", reason: part["refused"] };
    const before = (part["before"] ?? {}) as Item;
    const after = (part["after"] ?? {}) as Item;
    return {
      kind: "applied",
      item: wordsOf(after.title) ?? wordsOf(before.title) ?? "",
      changes: changesOf(before, after),
    };
  });
}
