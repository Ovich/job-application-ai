import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiText } from "../../../../src/app/ui/typography/text/text";

/**
 * The text (ID81): a variant from the app's own type scale, a tone, a weight, an
 * alignment, on whatever element the caller chose, so an h1 stays an h1. Its margins
 * are zeroed so the layout's gap alone spaces it.
 */

const classesOf = <T>(host: new () => T, selector: string): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiText], template: `<p uiText></p>` })
class Defaults {}

@Component({
  imports: [UiText],
  template: `<h1 uiText variant="figure" tone="muted" weight="semibold" align="center" class="tracking-tight"></h1>`,
})
class Given {}

@Component({
  imports: [UiText],
  template: `<p uiText tone="danger" weight="regular" align="start"></p>`,
})
class Other {}

describe("uiText", () => {
  it("is body text in the foreground tone by default, its margins zeroed", () => {
    expect(classesOf(Defaults, "p")).toEqual(["m-0", "text-body", "text-foreground"]);
  });

  it("takes a variant, a tone, a weight, an alignment and the caller's class, on the caller's element", () => {
    expect(classesOf(Given, "h1")).toEqual([
      "font-semibold",
      "m-0",
      "text-center",
      "text-figure",
      "text-muted-foreground",
      "tracking-tight",
    ]);
  });

  it("names the other tones, the regular weight and the start alignment", () => {
    expect(classesOf(Other, "p")).toEqual([
      "font-normal",
      "m-0",
      "text-body",
      "text-danger",
      "text-left",
    ]);
  });
});
