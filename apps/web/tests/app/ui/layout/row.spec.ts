import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiRow } from "../../../../src/app/ui/layout/row/row";

/** The horizontal row (ID81): items centred by default, a gap from the scale, wrap on request. */

const classesOf = <T>(host: new () => T, selector = "div"): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiRow], template: `<div uiRow></div>` })
class Defaults {}

@Component({
  imports: [UiRow],
  template: `<div uiRow gap="xs" align="start" justify="center" wrap class="mt-1"></div>`,
})
class Given {}

describe("uiRow", () => {
  it("is a centred row with the md gap by default", () => {
    expect(classesOf(Defaults)).toEqual(["flex", "flex-row", "gap-3", "items-center"]);
  });

  it("takes a gap, an alignment, a justification, wrap and the caller's class", () => {
    expect(classesOf(Given)).toEqual([
      "flex",
      "flex-row",
      "flex-wrap",
      "gap-1",
      "items-start",
      "justify-center",
      "mt-1",
    ]);
  });
});
