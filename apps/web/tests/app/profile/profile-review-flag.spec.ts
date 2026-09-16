import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { ProfileReviewFlag } from "../../../src/app/profile/profile-review-flag/profile-review-flag";

/**
 * `ProfileReviewFlag`, rendered alone (D16): what an item says about the assistant's review
 * of it. What is asserted is the text a person reads.
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const rendered = async (
  review: { state: string } | null,
  concern: { text: string } | null,
): Promise<HTMLElement> => {
  const fixture = TestBed.createComponent(ProfileReviewFlag);
  fixture.componentRef.setInput("review", review);
  fixture.componentRef.setInput("concern", concern);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe("the review flag (D16)", () => {
  it("says scope to clarify, beside the triangle, while the item is flagged and nothing is kept", async () => {
    const element = await rendered({ state: "waiting" }, null);

    expect(textOf(element)).toBe("scope to clarify");
    expect(element.querySelector("[data-part=ask]")).not.toBeNull();
  });

  it("says the concern kept, after a check, and no longer asks", async () => {
    const element = await rendered(
      { state: "answered" },
      { text: "Terraform: covered in a course, never production" },
    );

    expect(textOf(element)).toBe("✓ Terraform: covered in a course, never production");
    expect(element.querySelector("[data-part=ask]")).toBeNull();
  });

  it("draws nothing for an item never flagged and with no concern", async () => {
    const element = await rendered(null, null);

    expect(textOf(element)).toBe("");
    expect(element.querySelector("[data-part]")).toBeNull();
  });
});
