import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiContainer } from "../../../../src/app/ui/layout/container/container";

/** The container (ID81): a centred column at one of three widths, with responsive side padding. */

const classesOf = <T>(host: new () => T, selector = "div"): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiContainer], template: `<div uiContainer></div>` })
class Defaults {}

@Component({ imports: [UiContainer], template: `<div uiContainer width="sm"></div>` })
class Narrow {}

describe("uiContainer", () => {
  it("is a centred md column with side padding by default", () => {
    expect(classesOf(Defaults)).toEqual(["max-w-3xl", "mx-auto", "px-4", "sm:px-6", "w-full"]);
  });

  /** The width is the outer one, padding included, as with every width: 420 of content, as the mockup draws it, inside 24 a side. */
  it("takes the sm width, the sign-in column at 420 of content", () => {
    expect(classesOf(Narrow)).toEqual(["max-w-[468px]", "mx-auto", "px-4", "sm:px-6", "w-full"]);
  });
});
