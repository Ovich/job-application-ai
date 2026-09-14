import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import {
  Component,
  computed,
  contentChild,
  DestroyRef,
  inject,
  signal,
  type TemplateRef,
  type Type,
} from "@angular/core";
import { CurrentUser } from "../../auth/current-user";
import { initialsOf } from "../../auth/session";
import { ago, exactly } from "../../lib/ago";
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
 * **The concrete assistant may draw its own opening.** A `<ng-template #firstEntry>` given
 * as content is what entry 1 is drawn with, so the intake keeps the reading card between the
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

  /** The concrete assistant's own drawing of entry 1, `#firstEntry`, when it gives one. */
  protected readonly opening = contentChild<TemplateRef<unknown>>("firstEntry");

  /**
   * What the concrete assistant draws after an entry, `#afterEntry`, given the entry's
   * position from 1: the lines it said once that entry was stored and never stored
   * themselves (agent-consolidation `ID227`), so they read in order for the visit.
   */
  protected readonly afterEntry = contentChild<TemplateRef<unknown>>("afterEntry");

  /**
   * The person's avatar on what they write (`S4.7`): their initials, as the account button
   * shows them.
   */
  protected readonly initials = computed(() => initialsOf(this.currentUser.person()?.name ?? ""));

  /**
   * The time the phrases are said from, read again once a minute while the conversation
   * is on the screen (`ID220`), so `just now` becomes `1 min ago` with no reload.
   */
  private readonly now = signal(new Date());

  constructor() {
    const every = setInterval(() => this.now.set(new Date()), 60 * 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(every));
  }

  /** When an entry was stored, as a phrase: `5 min ago`. */
  protected when(createdAt: string): string {
    return ago(new Date(createdAt), this.now());
  }

  /** When an entry was stored, in full, for the hover. */
  protected exactlyWhen(createdAt: string): string {
    return exactly(new Date(createdAt));
  }

  /** The words of a `text` part. */
  protected textOf(part: Part): string {
    return "text" in part && typeof part.text === "string" ? part.text : "";
  }

  /** The component a provider draws this kind with, or `null` when none does. */
  protected componentFor(kind: string): Type<unknown> | null {
    return this.provided.find((each) => each.kind === kind)?.component ?? null;
  }
}
