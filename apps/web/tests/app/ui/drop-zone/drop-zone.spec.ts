import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiDropZone } from "../../../../src/app/ui/drop-zone/drop-zone";

/**
 * Seam E: `ui/drop-zone`, at its interface (criterion 8).
 *
 * Nothing is behind it: it is a DOM event in and an output out. It never reads a file
 * and never uploads one — bytes are the screen's business, and the route's — so what a
 * case asserts is which files left and how it looks while a drag is over it.
 *
 * Not past it: the browser's own file dialog. The end-to-end spec covers a real drop.
 */

@Component({
  imports: [UiDropZone],
  template: `<ui-drop-zone
    [compact]="compact()"
    accept="application/pdf"
    (filesChosen)="chosen.set($event)"
  />`,
})
class Screen {
  public readonly compact = signal(false);

  public readonly chosen = signal<File[] | null>(null);
}

const rendered = () => {
  const fixture = TestBed.createComponent(Screen);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    screen: fixture.componentInstance,
  };
};

const fileNamed = (name: string): File => new File(["not read by anything here"], name);

/** A drop, as a browser sends it: the files hang off the event's `dataTransfer`. */
const dropOf = (files: File[]): DragEvent => {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  return event;
};

const zoneOf = (host: HTMLElement) => host.querySelector("ui-drop-zone > *") as HTMLElement;

describe("ui-drop-zone", () => {
  it("emits both files of a drop, once", () => {
    const { host, screen, fixture } = rendered();

    zoneOf(host).dispatchEvent(dropOf([fileNamed("cv_FR.pdf"), fileNamed("cv_EN.pdf")]));
    fixture.detectChanges();

    expect(screen.chosen()?.map((file) => file.name)).toEqual(["cv_FR.pdf", "cv_EN.pdf"]);
  });

  it("emits what the picker's selection was", () => {
    const { host, screen, fixture } = rendered();
    const picker = host.querySelector("input[type=file]") as HTMLInputElement;
    // A `FileList` is not constructible and jsdom has no `DataTransfer`, so the picker
    // is given what a real selection would put there: an indexable list of files.
    Object.defineProperty(picker, "files", { value: [fileNamed("leCVWeb.docx")] });

    picker.dispatchEvent(new Event("change"));
    fixture.detectChanges();

    expect(screen.chosen()?.map((file) => file.name)).toEqual(["leCVWeb.docx"]);
  });

  it("opens the picker when Choose files is pressed", () => {
    const { host } = rendered();
    const picker = host.querySelector("input[type=file]") as HTMLInputElement;
    let opened = 0;
    picker.click = () => {
      opened += 1;
    };

    (
      Array.from(host.querySelectorAll("button")).find(
        (button) => (button.textContent ?? "").trim() === "Choose files",
      ) as HTMLButtonElement
    ).click();

    expect(opened).toBe(1);
  });

  /**
   * The drag counter, and the reason it exists: `dragleave` fires when the pointer
   * crosses onto a child, so a naive handler clears the active look while the pointer
   * is still inside the zone (the slice's "watch out").
   */
  it("stays active while the pointer crosses onto a child, and clears when it really leaves", () => {
    const { host, fixture } = rendered();
    const zone = zoneOf(host);
    const enter = () => zone.dispatchEvent(new Event("dragenter", { bubbles: true }));
    const leave = () => zone.dispatchEvent(new Event("dragleave", { bubbles: true }));

    enter();
    fixture.detectChanges();
    expect(zone.getAttribute("data-dragging")).toBe("true");

    // Onto a child: one more enter, then the leave of the element it left.
    enter();
    leave();
    fixture.detectChanges();
    expect(zone.getAttribute("data-dragging")).toBe("true");

    leave();
    fixture.detectChanges();
    expect(zone.getAttribute("data-dragging")).toBeNull();
  });

  it("says what it takes when it is empty, and asks for more once documents exist", () => {
    const { host, screen, fixture } = rendered();

    expect(host.textContent).toContain("Drop everything here");
    expect(host.textContent).toContain("CVs in PDF or Word, LinkedIn's data export");

    screen.compact.set(true);
    fixture.detectChanges();

    expect(host.textContent).toContain("Drop more here, or");
    expect(host.textContent).not.toContain("Drop everything here");
  });

  it("takes the media types the screen says it takes, and never reads a file", () => {
    const { host } = rendered();

    expect((host.querySelector("input[type=file]") as HTMLInputElement).accept).toBe(
      "application/pdf",
    );
  });
});
