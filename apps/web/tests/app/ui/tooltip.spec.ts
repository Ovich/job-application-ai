import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UiTooltip } from "../../../src/app/ui/tooltip/tooltip";

/**
 * The tooltip (ID161): a second telling on hover or focus, attached to the body so the
 * containers that clip everything else cannot clip it.
 */

@Component({
  imports: [UiTooltip],
  template: `<button type="button" [uiTooltip]="says()">Adjusting scope</button>`,
})
class Host {
  public readonly says = signal("Kubernetes");
}

describe("uiTooltip", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

  const target = () => (fixture.nativeElement as HTMLElement).querySelector("button");
  const panel = () => document.querySelector('[role="tooltip"]');

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    for (const each of Array.from(document.querySelectorAll('[role="tooltip"]'))) each.remove();
  });

  it("says nothing until a person asks", () => {
    expect(panel()).toBeNull();
    expect(target()?.getAttribute("aria-describedby")).toBeNull();
  });

  it("opens on hover, describing the element it is on", () => {
    target()?.dispatchEvent(new MouseEvent("mouseenter"));
    fixture.detectChanges();

    expect(panel()?.textContent).toBe("Kubernetes");
    expect(target()?.getAttribute("aria-describedby")).toBe(panel()?.id);
  });

  it("opens on focus too, because a keyboard reaches it the same way", () => {
    target()?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    fixture.detectChanges();

    expect(panel()?.textContent).toBe("Kubernetes");
  });

  it("closes on leave, on blur and on Escape", () => {
    for (const leaving of [
      () => target()?.dispatchEvent(new MouseEvent("mouseleave")),
      () => target()?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    ]) {
      target()?.dispatchEvent(new MouseEvent("mouseenter"));
      fixture.detectChanges();
      expect(panel()).not.toBeNull();

      leaving();
      fixture.detectChanges();
      expect(panel()).toBeNull();
    }
  });

  it("is attached to the body, where nothing clips it", () => {
    target()?.dispatchEvent(new MouseEvent("mouseenter"));
    fixture.detectChanges();

    expect(panel()?.parentElement).toBe(document.body);
    expect(fixture.nativeElement.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("stays quiet when there is nothing to say", () => {
    fixture.componentInstance.says.set("   ");
    fixture.detectChanges();

    target()?.dispatchEvent(new MouseEvent("mouseenter"));
    fixture.detectChanges();

    expect(panel()).toBeNull();
  });

  it("goes with the element it belongs to", () => {
    target()?.dispatchEvent(new MouseEvent("mouseenter"));
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    fixture.destroy();

    expect(panel()).toBeNull();
  });
});
