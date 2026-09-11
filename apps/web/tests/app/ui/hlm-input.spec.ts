import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { HlmInput } from "../../../src/app/ui/hlm-input";

/**
 * The text field (ID99), beside `hlmBtn`: one look for every input, full width, the
 * input token's border on the card surface, the control's size, and the focus ring the
 * buttons carry. A caller's own class merges in, so a field that needs a monospaced,
 * upper-case face adds it without restating the rest.
 */

const fieldOf = <T>(host: new () => T): HTMLInputElement | null => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector("input");
};

@Component({ imports: [HlmInput], template: `<input hlmInput type="text" />` })
class Plain {}

@Component({
  imports: [HlmInput],
  template: `<input hlmInput type="text" class="font-mono uppercase" />`,
})
class WithClass {}

describe("hlmInput", () => {
  it("is full width, bordered in the input token on the card surface, the control's size, with a focus ring", () => {
    expect(Array.from(fieldOf(Plain)?.classList ?? [])).toEqual(
      expect.arrayContaining([
        "w-full",
        "rounded-md",
        "border",
        "border-input",
        "bg-card",
        "text-ui",
        "focus-visible:ring-2",
        "focus-visible:ring-primary",
      ]),
    );
  });

  it("keeps a caller's own class beside its own", () => {
    const classes = Array.from(fieldOf(WithClass)?.classList ?? []);

    expect(classes).toEqual(expect.arrayContaining(["font-mono", "uppercase", "border-input"]));
  });
});
