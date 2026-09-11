import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { UiSpinner } from "../../../../src/app/ui/spinner/spinner";

/**
 * The spinner (ID99), the loader primitive: a ring turning beside a line that says what
 * is running. It says nothing itself, so it is hidden from a screen reader, and it holds
 * still under reduced motion, where the colour of its arc alone says it is working.
 */

const spinnerOf = <T>(host: new () => T): HTMLElement | null => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector("[uiSpinner]");
};

@Component({ imports: [UiSpinner], template: `<span uiSpinner></span>` })
class Defaults {}

@Component({ imports: [UiSpinner], template: `<span uiSpinner tone="danger"></span>` })
class Danger {}

describe("uiSpinner", () => {
  it("is a turning ring, hidden from a screen reader, still under reduced motion", () => {
    const spinner = spinnerOf(Defaults);

    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(spinner?.classList ?? [])).toEqual(
      expect.arrayContaining([
        "animate-spin",
        "rounded-full",
        "border-2",
        "border-border",
        "motion-reduce:animate-none",
      ]),
    );
  });

  it("draws its arc in the primary colour, or in the danger colour when asked", () => {
    expect(spinnerOf(Defaults)?.classList.contains("border-t-primary")).toBe(true);
    expect(spinnerOf(Danger)?.classList.contains("border-t-danger")).toBe(true);
    expect(spinnerOf(Danger)?.classList.contains("border-t-primary")).toBe(false);
  });
});
