import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { HlmBtn } from "../../../src/app/ui/hlm-button";

/** The button (ID98): the `lg` size, for a button that leads a screen, like a provider's. */

@Component({
  imports: [HlmBtn],
  template: `<button hlmBtn variant="secondary" size="lg">Continue with Google</button>`,
})
class Large {}

describe("hlmBtn", () => {
  it("has an lg size: taller, wider, in the body size", () => {
    const fixture = TestBed.createComponent(Large);
    fixture.detectChanges();
    const classes = Array.from(
      (fixture.nativeElement as HTMLElement).querySelector("button")?.classList ?? [],
    );

    expect(classes).toEqual(
      expect.arrayContaining(["h-auto", "gap-3.5", "px-4.5", "py-3.5", "text-body"]),
    );
    expect(classes).not.toContain("h-10");
  });
});
