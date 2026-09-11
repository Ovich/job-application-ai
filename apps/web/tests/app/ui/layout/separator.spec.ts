import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiSeparator } from "../../../../src/app/ui/layout/separator/separator";

/** The separator (ID97): a divider on a native `<hr>`, its space above and below from the scale. */

const classesOf = <T>(host: new () => T): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector("hr");
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiSeparator], template: `<hr uiSeparator />` })
class Defaults {}

@Component({ imports: [UiSeparator], template: `<hr uiSeparator space="md" />` })
class Wider {}

@Component({ imports: [UiSeparator], template: `<hr uiSeparator class="w-1/2" />` })
class WithClass {}

describe("uiSeparator", () => {
  it("is a divider in the border token, xs above and below by default", () => {
    expect(classesOf(Defaults)).toEqual(["border-border", "my-1"]);
  });

  it("takes its space from the scale", () => {
    expect(classesOf(Wider)).toEqual(["border-border", "my-3"]);
  });

  it("keeps a caller's own class", () => {
    expect(classesOf(WithClass)).toEqual(["border-border", "my-1", "w-1/2"]);
  });
});
