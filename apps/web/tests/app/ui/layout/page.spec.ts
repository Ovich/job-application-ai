import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiPage } from "../../../../src/app/ui/layout/page/page";

/** The page (ID81): the column under the AppBar, filling the height, with top air and the lg gap. */

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
  it("fills the height as a column with the lg gap and top padding", () => {
    expect(classesOf(Defaults)).toEqual(["flex", "flex-1", "flex-col", "gap-4", "pt-6"]);
  });

  it("merges the caller's class", () => {
    expect(classesOf(Given)).toEqual([
      "flex",
      "flex-1",
      "flex-col",
      "gap-4",
      "items-center",
      "pt-6",
    ]);
  });
});
