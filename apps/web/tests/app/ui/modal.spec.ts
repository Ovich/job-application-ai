import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { UiModal } from "../../../src/app/ui/modal/modal";

/**
 * The modal (ID160): the page dimmed, one panel over it, the caller's content inside.
 *
 * What is asserted here is the primitive's whole contract — what it is called, the three
 * ways out, and that it owns none of what it holds. A caller's own buttons are the
 * caller's business and appear in its tests, not in these.
 */

@Component({
  imports: [UiModal],
  template: `
    @if (open()) {
      <ui-modal title="Add documents" [dismissible]="dismissible()" (close)="left.set(true)">
        <p>Whatever the caller puts here.</p>
        <button type="button">The caller's own button</button>
      </ui-modal>
    }
  `,
})
class Host {
  public readonly open = signal(true);
  public readonly dismissible = signal(true);
  public readonly left = signal(false);
}

describe("ui-modal", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

  const page = () => fixture.nativeElement as HTMLElement;
  const panel = () => page().querySelector<HTMLElement>("[data-panel]");
  const backdrop = () => page().querySelector<HTMLElement>("[data-backdrop]");
  const closeControl = () => page().querySelector<HTMLButtonElement>('[aria-label="Close"]');

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it("is a dialog labelled by its title, over a dimmed page", () => {
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.getAttribute("aria-modal")).toBe("true");
    const labelledBy = panel()?.getAttribute("aria-labelledby") ?? "";
    expect(page().querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe("Add documents");
    expect(backdrop()).not.toBeNull();
  });

  it("holds the caller's content and none of the caller's business", () => {
    expect(page().textContent).toContain("Whatever the caller puts here.");
    expect(page().textContent).toContain("The caller's own button");
    // The only control of its own is the way out.
    const buttons = Array.from(page().querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
    );
    expect(buttons).toEqual(["Close", "The caller's own button"]);
  });

  it("leaves on the close control", () => {
    closeControl()?.click();

    expect(fixture.componentInstance.left()).toBe(true);
  });

  it("leaves on Escape", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.left()).toBe(true);
  });

  it("leaves on a press on the dimmed page, and not on one inside the panel", () => {
    panel()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.left()).toBe(false);

    backdrop()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.left()).toBe(true);
  });

  it("offers no way out at all when the caller says it must not be interrupted", () => {
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();

    expect(closeControl()).toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    backdrop()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.left()).toBe(false);
  });
});
