import {
  afterNextRender,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { HlmBtn } from "../../ui/hlm-button";
import { UiText } from "../../ui/typography/text/text";
import { ToolDock } from "../tool-dock/tool-dock";
import { ToolPrefix } from "../tool-prefix/tool-prefix";

/**
 * The bar the person answers in, and the dock above it. **Abstract**: one chrome for
 * every tool of every use case, and it holds no word of any of them — the prefix's own
 * word and where a person is both arrive with the tool they are about.
 *
 * The tool sits in the dock, its `ToolPrefix` at the head of the bar, the text as the
 * comment, and **one button** that commits it (the person, 2026-09-14): an icon, the
 * same whether it sends or saves, its accessible name saying which. It is **disabled
 * until a row is picked or something is typed**, because a save that writes nothing is
 * a rule that says nothing.
 *
 * **Two modes, one line or many** (the person, 2026-09-14). Enter commits, always, in
 * either. Alt+Enter is the new-line key: it breaks the line where the caret is, and a
 * bar that was one line opens a text area above itself, the single line gone and the
 * prefix and the button staying where they were. Emptying the text is the only way back
 * to one line, so a person who deletes their last line break mid-thought is not thrown
 * out of the space they were writing in.
 *
 * Where a person is — the path its tool carries — sits between the dock and the bar while
 * the bar is one line, and takes the line's place, between the prefix and the button,
 * once the text has moved above.
 *
 * It calls nothing and decides nothing about what the × means: that is the assistant's,
 * and while a question waits the × is a skip (the mockup's handoff note).
 */
@Component({
  selector: "composer",
  imports: [HlmBtn, ToolDock, ToolPrefix, UiText],
  templateUrl: "./composer.html",
  // The working end of the column, and it says so (the person, 2026-09-13): a surface of
  // its own, a firmer line above it and a shadow that lifts it off the conversation, so
  // what has been said and what is being answered are told apart at a glance.
  host: {
    class:
      "flex min-h-0 flex-col border-border border-t-2 bg-muted px-6 pt-4 pb-5 shadow-[0_-6px_16px_-12px_rgb(0_0_0/0.35)]",
  },
})
export class Composer {
  /**
   * What the open tool is about — the word its use case names the relation with, what
   * that word means, and where a person is — or `null` when no tool is open and the dock
   * is closed.
   */
  public readonly tool = input<{ label: string; describes: string; where: string } | null>(null);

  /** Whether what is already chosen would be enough to save. */
  public readonly canSave = input<boolean>(false);

  /** What the bar says while nothing is typed, given by the concrete assistant (D7). */
  public readonly placeholder = input<string>("");

  public readonly save = output<void>();

  public readonly clear = output<void>();

  /** What the person has typed. The parent reads it when they save. */
  public readonly draft = signal("");

  /** Whether the text has moved above the bar. Entered by Alt+Enter, left by emptying. */
  protected readonly multiline = signal(false);

  /** What the one button does, said to whoever cannot see its icon. */
  protected readonly verb = computed(() => (this.tool() === null ? "Send" : "Save"));

  protected readonly ready = computed(() => this.canSave() || this.draft().trim() !== "");

  /**
   * How tall the text area stands: the lines written and one empty row under them, so the
   * last line never sits on the bar (the person, 2026-09-14) — never fewer than two, and
   * never more than eight, past which it scrolls rather than pushing the conversation off
   * the column.
   */
  protected readonly rows = computed(() =>
    Math.min(8, Math.max(2, this.draft().split("\n").length + 1)),
  );

  private readonly line = viewChild<ElementRef<HTMLInputElement>>("line");

  private readonly lines = viewChild<ElementRef<HTMLTextAreaElement>>("lines");

  private readonly injector = inject(Injector);

  protected typed(event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.set(value);
    if (value === "") this.toOneLine();
  }

  /**
   * Enter commits and Alt+Enter breaks the line, in either mode. A key pressed while an
   * input method is still composing a character belongs to the composition, not to this
   * bar: committing then would send half a word.
   */
  protected pressed(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (event.altKey) {
      this.breakLine(event.target as HTMLInputElement | HTMLTextAreaElement);
      return;
    }
    if (this.ready()) this.save.emit();
  }

  /** The draft is spent once it has been saved: the next question starts empty, on one line. */
  public clearDraft(): void {
    this.draft.set("");
    this.multiline.set(false);
  }

  /**
   * A line break where the caret is, or in place of what is selected, and the caret just
   * after it. The field it happened in may be about to be replaced by the other one, so
   * the caret is put back once the view has caught up.
   */
  private breakLine(field: HTMLInputElement | HTMLTextAreaElement): void {
    const value = field.value;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    const next = `${value.slice(0, start)}\n${value.slice(end)}`;
    const caret = start + 1;
    this.draft.set(next);
    this.multiline.set(true);
    afterNextRender(
      () => {
        const area = this.lines()?.nativeElement;
        if (area === undefined) return;
        area.value = next;
        area.focus();
        area.setSelectionRange(caret, caret);
      },
      { injector: this.injector },
    );
  }

  /** Back to one line, with the person still in it. */
  private toOneLine(): void {
    if (!this.multiline()) return;
    this.multiline.set(false);
    afterNextRender(() => this.line()?.nativeElement.focus(), { injector: this.injector });
  }
}
