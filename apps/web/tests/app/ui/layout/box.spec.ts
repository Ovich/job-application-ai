import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiBox } from "../../../../src/app/ui/layout/box/box";

/** The box (ID81): padding from the scale, a surface, a radius, a border. Nothing else. */

const classesOf = <T>(host: new () => T, selector = "div"): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiBox], template: `<div uiBox></div>` })
class Defaults {}

@Component({
  imports: [UiBox],
  template: `<div uiBox p="lg" surface="danger-soft" radius="md" border class="relative"></div>`,
})
class Given {}

@Component({ imports: [UiBox], template: `<div uiBox px="md" py="xs" surface="card"></div>` })
class Sides {}

describe("uiBox", () => {
  it("adds nothing by default", () => {
    expect(classesOf(Defaults)).toEqual([]);
  });

  it("takes padding, a surface, a radius, a border and the caller's class", () => {
    expect(classesOf(Given)).toEqual([
      "bg-danger-soft",
      "border",
      "border-border",
      "p-4",
      "relative",
      "rounded-md",
    ]);
  });

  it("pads the two axes on their own", () => {
    expect(classesOf(Sides)).toEqual(["bg-card", "px-3", "py-1"]);
  });
});
