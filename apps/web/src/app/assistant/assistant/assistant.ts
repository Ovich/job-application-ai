import { Component, input, output, viewChild } from "@angular/core";
import { Composer } from "../composer/composer";

/**
 * The assistant's column, abstract (`S7.4`, the person's own comment: *"We need to make
 * the core assistant that is than reused by profile intake, cv builder, cover builder.
 * The core remains the same, its tooling change depending of the context, as well as
 * maybe prompts"*).
 *
 * What is core is the chrome and nothing else: a scrolling conversation, a dock for
 * whichever tool is open, a prefix saying what that tool is about, a text bar and one
 * button whose verb follows the dock. What is not core is every word — the greeting, the
 * openers, the sentences, the tool, and the word the prefix names the relation with —
 * and none of it is here. A use case projects its own conversation into this column and
 * its own tool into the dock, and this component never learns which use case it is
 * serving.
 *
 * **Nothing under `app/assistant/` may import from a use case's folder**, and
 * `tests/conventions/core-assistant.test.ts` fails the build on it: an abstract
 * container that reaches into one concrete use is that use's container with a longer
 * path.
 *
 * Two slots, and the distinction is the whole interface: what is written goes into the
 * conversation, and what is marked `assistantTool` goes into the dock. The draft the
 * person types belongs to the chrome, so the composer keeps it and this column hands it
 * over when the use case saves.
 */
@Component({
  selector: "assistant",
  imports: [Composer],
  templateUrl: "./assistant.html",
  host: { class: "flex h-full min-h-0 min-w-0 flex-1 flex-col" },
})
export class Assistant {
  /** What the open tool is about, or `null` when the dock is closed. */
  public readonly tool = input<{ label: string; what: string } | null>(null);

  /** Whether what is already chosen would be enough to save. */
  public readonly canSave = input<boolean>(false);

  public readonly save = output<void>();

  public readonly clear = output<void>();

  private readonly composer = viewChild(Composer);

  /** What the person has typed, which the use case reads when they save. */
  public draft(): string {
    return this.composer()?.draft() ?? "";
  }

  /** The draft is spent once it has been saved: the next question starts empty. */
  public clearDraft(): void {
    this.composer()?.clearDraft();
  }
}
