import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import { Component, contentChild, inject, TemplateRef, type Type } from "@angular/core";
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
 * No inputs and no outputs: it reads the core and the parts it is given by injection,
 * and holds no call of its own.
 */
@Component({
  selector: "assistant-conversation",
  imports: [NgComponentOutlet, NgTemplateOutlet, UiText],
  templateUrl: "./assistant-conversation.html",
  host: { class: "flex flex-col gap-5" },
})
export class AssistantConversation {
  private readonly core = inject(AssistantCore);

  private readonly provided = inject(ASSISTANT_PARTS, { optional: true }) ?? [];

  protected readonly entries = this.core.entries;

  /** The reply streaming now, drawn as a stored reply is drawn once it has landed. */
  protected readonly replying = this.core.replying;

  /** What went wrong, in one sentence. */
  protected readonly failure = this.core.failure;

  /** The concrete assistant's own drawing of the opening, when it gives one. */
  protected readonly opening = contentChild(TemplateRef);

  /** The words of a `text` part. */
  protected textOf(part: Part): string {
    return "text" in part && typeof part.text === "string" ? part.text : "";
  }

  /** The component a provider draws this kind with, or `null` when none does. */
  protected componentFor(kind: string): Type<unknown> | null {
    return this.provided.find((each) => each.kind === kind)?.component ?? null;
  }
}
