import { Component, computed, ElementRef, inject, input, output, signal } from "@angular/core";
import { HlmBtn } from "../hlm-button";
import { UiText } from "../typography/text/text";

/**
 * The one place everything goes (ID124, `D3`): a dashed panel a person drops any number
 * of documents on, with a button for those who would rather pick.
 *
 * It is a primitive rather than a part of the intake screen because a second screen will
 * want it, and it is written so that it can be: **it never reads a file and never
 * uploads one.** Bytes are the screen's business and the route's; what leaves here is
 * the files a person chose, and the screen decides what happens to them.
 *
 * What it hides is the hidden file input, and the drag counter. A `dragleave` fires when
 * the pointer crosses onto a child element, so a handler that cleared the active look on
 * every leave would flicker the whole time a person hovers over the words inside it.
 * Enters and leaves are counted, and the look is on while the count is above zero.
 */
@Component({
  selector: "ui-drop-zone",
  imports: [HlmBtn, UiText],
  templateUrl: "./drop-zone.html",
})
export class UiDropZone {
  /** The row form, once the screen has documents to show above it. */
  public readonly compact = input(false);

  /** The media types the screen will take, handed to the picker. */
  public readonly accept = input("");

  /** What a person chose, by dropping or by picking. */
  public readonly filesChosen = output<File[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly depth = signal(0);

  protected readonly dragging = computed(() => this.depth() > 0);

  protected onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.depth.update((depth) => depth + 1);
  }

  protected onDragLeave(): void {
    this.depth.update((depth) => Math.max(0, depth - 1));
  }

  /** Without this the browser opens the file instead of letting the page have it. */
  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.depth.set(0);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) this.filesChosen.emit(files);
  }

  protected choose(): void {
    this.picker()?.click();
  }

  protected onPicked(): void {
    const picker = this.picker();
    const files = Array.from(picker?.files ?? []);
    if (files.length > 0) this.filesChosen.emit(files);
    // Cleared, so choosing the same file twice in a row is two events and not one: the
    // screen decides what a second drop of the same document means, not the browser.
    if (picker !== undefined && picker !== null) picker.value = "";
  }

  private picker(): HTMLInputElement | null {
    return this.host.nativeElement.querySelector("input[type=file]");
  }
}
