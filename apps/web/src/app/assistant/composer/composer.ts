import { Component, computed, input, output, signal } from "@angular/core";
import { HlmBtn } from "../../ui/hlm-button";
import { UiText } from "../../ui/typography/text/text";
import { ToolDock } from "../tool-dock/tool-dock";
import { ToolPrefix } from "../tool-prefix/tool-prefix";

/**
 * The bar the person answers in, and the dock above it. **Abstract**: one chrome for
 * every tool of every use case, and it holds no word of any of them — the prefix's own
 * word arrives with the tool it is about.
 *
 * The tool sits in the dock, its `ToolPrefix` at the head of
 * the bar, the text as the comment, and the button as the verb — `Save` while a tool is
 * open, `Send` otherwise. It is **disabled until a row is picked or something is typed**,
 * because a save that writes nothing is a rule that says nothing.
 *
 * It calls nothing and decides nothing about what the × means: that is the assistant's,
 * and while a question waits the × is a skip (the mockup's handoff note).
 */
@Component({
  selector: "composer",
  imports: [HlmBtn, ToolDock, ToolPrefix, UiText],
  templateUrl: "./composer.html",
  host: { class: "block border-border border-t bg-card px-6 pt-4 pb-5" },
})
export class Composer {
  /**
   * What the open tool is about — the word its use case names the relation with, and the
   * thing itself — or `null` when no tool is open and the dock is closed.
   */
  public readonly tool = input<{ label: string; what: string } | null>(null);

  /** Whether what is already chosen would be enough to save. */
  public readonly canSave = input<boolean>(false);

  public readonly save = output<void>();

  public readonly clear = output<void>();

  /** What the person has typed. The parent reads it when they save. */
  public readonly draft = signal("");

  protected readonly verb = computed(() => (this.tool() === null ? "Send" : "Save"));

  protected readonly ready = computed(() => this.canSave() || this.draft().trim() !== "");

  protected typed(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  /** The draft is spent once it has been saved: the next question starts empty. */
  public clearDraft(): void {
    this.draft.set("");
  }
}
