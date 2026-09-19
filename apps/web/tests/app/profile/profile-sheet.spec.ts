import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { ProfileSheet } from "../../../src/app/profile/profile-sheet/profile-sheet";
import { emptyProfile, type Item, itemOf, type Profile } from "../../support/intake";

/**
 * The sheet at its own seam: what it no longer says about where a fact came from, and
 * what it no longer says about a review (product-flow-rework `H10`, `H6`, `ID334`).
 *
 * Behind it: nothing but the DOM, as in `profile-sheet-focused.spec.ts`.
 *
 * The wire is still the other arm's to change, so a count and a concern are handed in
 * here exactly as the interface still answers them. That is the point: what is asserted
 * is that the sheet draws neither, whether or not the field is still sent.
 */

/** An item as the wire still carries it, counts and quotes included (`S4.1` is arm B's). */
const asTheWireStillSends = (item: Item, documents: number): Item =>
  ({ ...item, documents, sources: [{ document: "cv.pdf", said: "HEIG-VD" }] }) as Item;

const aProfile = (): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 4,
  experience: [
    asTheWireStillSends(
      itemOf({
        id: "post",
        kind: "experience",
        title: "R&D Collaborator in Software Engineering",
        experience: {
          organisation: "HEIG-VD",
          organisationNote: null,
          location: "Yverdon-les-Bains",
          arrangement: null,
        },
        lines: [{ id: "line-1", text: "Academic Assistant for the TWEB course." }],
      }),
      4,
    ),
  ],
  groups: [
    asTheWireStillSends(
      itemOf({
        id: "group",
        kind: "group",
        title: "DevOps and cloud",
        children: [
          itemOf({
            id: "terraform",
            kind: "entry",
            title: "Terraform",
            entry: { label: "Terraform", qualifier: null },
            concern: {
              id: "r1",
              text: "Terraform: covered in a course, never production",
              kind: "constraint",
              source: "answer",
              createdAt: "2026-09-12T10:14:00.000Z",
              supersededBy: null,
            },
          }),
        ],
      }),
      3,
    ),
  ],
});

const rendered = async () => {
  const fixture = TestBed.createComponent(ProfileSheet);
  fixture.componentRef.setInput("profile", aProfile());
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return {
    element,
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    regionOf: (id: string) => element.querySelector<HTMLElement>(`[data-id="${id}"]`),
  };
};

describe("where a fact came from (`H10`)", () => {
  it("draws no count of documents on a region that has documents behind it", async () => {
    const { element, text, regionOf } = await rendered();

    expect(regionOf("post")).not.toBeNull();
    expect(element.querySelectorAll("[data-part=from]").length).toBe(0);
    expect(text).not.toMatch(/\d+ documents?\b/);
  });

  it("keeps the headings, which count the rows below them and not documents", async () => {
    const { text } = await rendered();

    // The one figure left is a count of what was drawn: a heading says how many rows
    // hang under it. It is never a count of the documents a part came from.
    expect(text).toContain("1 thing in 1 group");
    expect(text).not.toMatch(/\d+ documents?\b/);
  });
});

describe("what a review used to leave behind (`H6`)", () => {
  it("draws no check line under an item that carries a concern", async () => {
    const { element, text, regionOf } = await rendered();

    expect(regionOf("terraform")).not.toBeNull();
    expect(element.querySelectorAll("[data-part=concern]").length).toBe(0);
    expect(text).not.toContain("✓");
    expect(text).not.toContain("covered in a course, never production");
  });
});
