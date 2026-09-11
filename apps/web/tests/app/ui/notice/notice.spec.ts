import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { AppNotice } from "../../../../src/app/ui/notice/notice";

/**
 * The notice (ID82): one message above the content, in the tone it is in. Its seam is
 * what a person and a screen reader meet: the role, the words, and the glyph's shape,
 * which carries the meaning without the colour (the design language's status rule).
 */

const rendered = <T>(host: new () => T): HTMLElement => {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
};

@Component({
  imports: [AppNotice],
  template: `<app-notice tone="danger" lead="Google did not finish signing you in."
    >Nothing was created.</app-notice
  >`,
})
class Failure {}

@Component({
  imports: [AppNotice],
  template: `<app-notice tone="ok" lead="Your account is deleted."
    >Everything it held is gone.</app-notice
  >`,
})
class Done {}

@Component({
  imports: [AppNotice],
  template: `<app-notice tone="warn" lead="Your membership is cancelled."
    >Credits you have left are not refunded.</app-notice
  >`,
})
class Warning {}

/** The triangle, drawn by clipping the glyph's box to one. */
const triangle = "[clip-path:polygon(50%_0,100%_100%,0_100%)]";

describe("app-notice", () => {
  it("is an alert in the danger tone, its lead then its body", () => {
    const notice = rendered(Failure).querySelector("app-notice");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Google did not finish signing you in. Nothing was created.",
    );
  });

  it("is a status in the ok tone, its lead then its body", () => {
    const notice = rendered(Done).querySelector("app-notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Your account is deleted. Everything it held is gone.",
    );
  });

  it("is a note in the warn tone, its lead then its body", () => {
    const notice = rendered(Warning).querySelector("app-notice");
    expect(notice?.getAttribute("role")).toBe("note");
    expect(notice?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Your membership is cancelled. Credits you have left are not refunded.",
    );
  });

  it("draws a triangle for a warning, and neither a square nor a round", () => {
    const glyph = rendered(Warning).querySelector("[aria-hidden=true]");
    expect(glyph?.classList.contains(triangle)).toBe(true);
    expect(glyph?.classList.contains("rounded-full")).toBe(false);
  });

  it("draws a square for a failure and a round for a success", () => {
    const square = rendered(Failure).querySelector("[aria-hidden=true]");
    const round = rendered(Done).querySelector("[aria-hidden=true]");
    expect(square?.classList.contains("rounded-full")).toBe(false);
    expect(round?.classList.contains("rounded-full")).toBe(true);
  });
});
