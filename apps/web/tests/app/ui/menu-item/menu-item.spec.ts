import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiMenuItem } from "../../../../src/app/ui/menu-item/menu-item";

/**
 * The menu item (ID98): one row of a menu, full width, left aligned, shaded on hover, a
 * `menuitem` to a screen reader, in the foreground or, for what cannot be undone, the
 * danger tone.
 */

const rendered = <T>(host: new () => T): HTMLButtonElement | null => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector("button");
};

const classesOf = (button: HTMLButtonElement | null): string[] =>
  Array.from(button?.classList ?? []).sort();

@Component({ imports: [UiMenuItem], template: `<button uiMenuItem>Sign out</button>` })
class Plain {}

@Component({
  imports: [UiMenuItem],
  template: `<button uiMenuItem tone="danger">Delete my account</button>`,
})
class Danger {}

describe("uiMenuItem", () => {
  it("is a full-width, left-aligned row in the foreground, shaded on hover", () => {
    expect(classesOf(rendered(Plain))).toEqual(
      [
        "block",
        "hover:bg-muted",
        "m-0",
        "px-3",
        "py-2",
        "rounded-md",
        "text-foreground",
        "text-left",
        "text-ui",
        "w-full",
      ].sort(),
    );
  });

  it("is a menuitem and a plain button, never a submit", () => {
    const button = rendered(Plain);
    expect(button?.getAttribute("role")).toBe("menuitem");
    expect(button?.getAttribute("type")).toBe("button");
  });

  it("takes the danger tone for what cannot be undone", () => {
    const classes = classesOf(rendered(Danger));
    expect(classes).toContain("text-danger");
    expect(classes).not.toContain("text-foreground");
  });
});
