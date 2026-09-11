import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiSpacer } from "../../../../src/app/ui/layout/spacer/spacer";

/** The spacer (ID81): the pusher in a row, and nothing else. */

@Component({ imports: [UiSpacer], template: `<span uiSpacer></span>` })
class Defaults {}

describe("uiSpacer", () => {
  it("takes the remaining room", () => {
    const fixture = TestBed.createComponent(Defaults);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector("span");

    expect(Array.from(element?.classList ?? [])).toEqual(["flex-1"]);
  });
});
