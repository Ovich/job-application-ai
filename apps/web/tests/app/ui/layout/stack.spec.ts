import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiStack } from "../../../../src/app/ui/layout/stack/stack";

/**
 * The vertical stack (ID81): a column with a gap from the design language's scale.
 * Its seam is the host element's classes; a caller's own class still merges, and a
 * utility the caller writes wins over the directive's.
 */

/** The host element's classes, sorted: the one thing a layout directive decides. */
const classesOf = <T>(host: new () => T, selector = "div"): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiStack], template: `<div uiStack></div>` })
class Defaults {}

@Component({
  imports: [UiStack],
  template: `<div uiStack gap="xl" align="center" justify="between" class="min-h-screen"></div>`,
})
class Given {}

@Component({ imports: [UiStack], template: `<div uiStack gap="md" class="gap-8"></div>` })
class Overridden {}

describe("uiStack", () => {
  it("is a column with the md gap by default", () => {
    expect(classesOf(Defaults)).toEqual(["flex", "flex-col", "gap-3"]);
  });

  it("takes a gap, an alignment, a justification and the caller's class", () => {
    expect(classesOf(Given)).toEqual([
      "flex",
      "flex-col",
      "gap-6",
      "items-center",
      "justify-between",
      "min-h-screen",
    ]);
  });

  it("lets the caller's utility win over its own", () => {
    expect(classesOf(Overridden)).toEqual(["flex", "flex-col", "gap-8"]);
  });
});
