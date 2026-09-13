import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiPage } from "../../../../src/app/ui/layout/page/page";

/**
 * The page (ID81): the column under the AppBar, filling the height, with top air and the
 * lg gap — and, since 2026-09-12, the thing that scrolls when a screen is long. The
 * window does not: the shell is exactly the viewport's height, so the bar stays put and
 * an assistant layout can fill what is left and scroll inside itself.
 */

const classesOf = <T>(host: new () => T, selector = "main"): string[] => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  return Array.from(element?.classList ?? []).sort();
};

@Component({ imports: [UiPage], template: `<main uiPage></main>` })
class Defaults {}

@Component({ imports: [UiPage], template: `<main uiPage class="items-center"></main>` })
class Given {}

describe("uiPage", () => {
  it("fills the height as a column that scrolls, with the lg gap and top padding", () => {
    expect(classesOf(Defaults)).toEqual([
      "flex",
      "flex-1",
      "flex-col",
      "gap-4",
      "min-h-0",
      "overflow-y-auto",
      "pt-6",
    ]);
  });

  it("merges the caller's class", () => {
    expect(classesOf(Given)).toEqual([
      "flex",
      "flex-1",
      "flex-col",
      "gap-4",
      "items-center",
      "min-h-0",
      "overflow-y-auto",
      "pt-6",
    ]);
  });
});
