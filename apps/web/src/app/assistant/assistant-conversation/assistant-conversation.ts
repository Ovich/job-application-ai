import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import { Component, computed, contentChild, inject, TemplateRef, type Type } from "@angular/core";
import { CurrentUser } from "../../auth/current-user";
import { initialsOf } from "../../auth/session";
import { UiText } from "../../ui/typography/text/text";
import { AssistantCore, type Entry } from "../assistant-core";
import { ASSISTANT_PARTS } from "../provide-assistant";

/** One part of an entry, whatever its kind. */
type Part = Entry["parts"][number];

/**
 * The conversation the screen's `AssistantCore` holds, drawn (`ID175`, the spec's
 * *Drawing it*).
 *
 * It draws `text` itself and hands every other part to the component an
 * `ASSISTANT_PARTS` provider maps its kind to. **A part no provider names is drawn as a
 * placeholder and never dropped** (the spec's *Failure modes*): an entry written by a
 * later catalogue still takes its place in the conversation.
 *
 * **The concrete assistant may draw its own opening.** A `<ng-template>` given as content
 * is what entry 1 is drawn with, so the intake keeps the reading card between the
 * opening's sentences, which is drawn from the profile and not stored (`ID200`), and the
 * opening is still drawn once, in its place. With none given, entry 1 is drawn like
 * every other.
 *
 * **Who wrote an entry is where it sits** (`S4.7`, spec `H26`): what the assistant writes,
 * its streaming reply and its records included, takes the column's full width behind its
 * avatar; what the person writes, and the parts of their own tool use, sits on the right at
 * most 70% wide, the components library's `.me` bubble, behind their initials.
 *
 * No inputs and no outputs: it reads the core, the person signed in and the parts it is
 * given by injection, and holds no call of its own.
 */
@Component({
  selector: "assistant-conversation",
  imports: [NgComponentOutlet, NgTemplateOutlet, UiText],
  templateUrl: "./assistant-conversation.html",
  host: { class: "flex flex-col gap-5" },
})
export class AssistantConversation {
  private readonly core = inject(AssistantCore);

  private readonly currentUser = inject(CurrentUser);

  private readonly provided = inject(ASSISTANT_PARTS, { optional: true }) ?? [];

  protected readonly entries = this.core.entries;

  /** The reply streaming now, drawn as a stored reply is drawn once it has landed. */
  protected readonly replying = this.core.replying;

  /** What went wrong, in one sentence. */
  protected readonly failure = this.core.failure;

  /** What the agent is doing now, drawn beside an animated indicator until its words land. */
  protected readonly activity = this.core.activity;

  /** The concrete assistant's own drawing of the opening, when it gives one. */
  protected readonly opening = contentChild(TemplateRef);

  /**
   * The person's avatar on what they write (`S4.7`): their initials, as the account button
   * shows them.
   */
  protected readonly initials = computed(() => initialsOf(this.currentUser.person()?.name ?? ""));

  /** The words of a `text` part. */
  protected textOf(part: Part): string {
    return "text" in part && typeof part.text === "string" ? part.text : "";
  }

  /** The component a provider draws this kind with, or `null` when none does. */
  protected componentFor(kind: string): Type<unknown> | null {
    return this.provided.find((each) => each.kind === kind)?.component ?? null;
  }
}
