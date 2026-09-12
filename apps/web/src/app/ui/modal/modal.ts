import { afterNextRender, Component, ElementRef, inject, input, output } from "@angular/core";
import { UiText } from "../typography/text/text";

/** Each modal's title its own id, so the panel can be labelled by it. */
let opened = 0;

/**
 * A modal: the page dimmed, one panel over it, and whatever the caller puts inside
 * (ID160, the person 2026-09-12).
 *
 * It is not the acknowledge gate beside it. That one asks a person to confirm one
 * action and carries its own Cancel and its own verb; this one holds a screen — a drop
 * zone, a form, a document — and knows nothing about what the screen is for. A caller
 * that wants a question asks `app-acknowledge-action`; a caller that wants a piece of
 * the product on top of the page asks for this.
 *
 * What it owns: the dimming, the panel, the title, the way out, and where the focus
 * goes. What it never owns: the content, its buttons, or when it closes — the caller
 * creates it to open it and destroys it to close it, as the gate does (ID94's
 * controlled mode), so there is no `open` input and no state here to disagree with the
 * caller's.
 *
 * The way out is three: the close control, Escape, and a press on the dimmed page
 * outside the panel — all one `close` output, because a person leaving is one event
 * whichever gesture they used. A caller in the middle of something that must not be
 * interrupted passes `dismissible: false`, and then only its own content can end it.
 */
@Component({
  selector: "ui-modal",
  imports: [UiText],
  templateUrl: "./modal.html",
  host: {
    class: "fixed inset-0 z-50 flex items-center justify-center p-4",
    "(document:keydown.escape)": "leave()",
  },
})
export class UiModal {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** What the panel is called, and what labels it for a screen reader. */
  public readonly title = input.required<string>();

  /** How wide the panel may grow. The default suits a form or a drop zone. */
  public readonly width = input<"md" | "lg">("md");

  /** Whether a person may leave by Escape, the close control or the page behind it. */
  public readonly dismissible = input<boolean>(true);

  /** A person leaving, whichever of the three ways they took. */
  public readonly close = output<void>();

  protected readonly titleId = `modal-${++opened}`;

  protected readonly panelWidth = () => (this.width() === "lg" ? "max-w-3xl" : "max-w-xl");

  constructor() {
    // The focus goes into the panel when it opens, so a keyboard is inside it and
    // Escape means this rather than whatever was focused before.
    afterNextRender(() => {
      const panel = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
        "[data-panel]",
      );
      panel?.focus();
    });
  }

  protected leave(): void {
    if (this.dismissible()) this.close.emit();
  }

  /** A press on the dimmed page, and not one that began inside the panel. */
  protected leaveIfOutside(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.leave();
  }
}
