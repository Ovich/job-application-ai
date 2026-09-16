import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { ProfileSheet } from "../../../src/app/profile/profile-sheet/profile-sheet";
import { emptyProfile, itemOf, type Profile, questionOf } from "../../support/intake";

/**
 * Seam E, the half of it that is the sheet: `profile/profile-sheet` under an open tool
 * (criterion 10, rules 1, 2, 3, and the ask mark and the check line).
 *
 * Behind it: nothing but the DOM. The hover rule itself is CSS and has no computed style
 * in jsdom, so what is asserted here is that the selector is on the element a browser
 * will read it from; the lighting itself is the end-to-end spec's, in a browser that has
 * the stylesheet.
 *
 * Not past it: the placement, which is `profile/reveal`'s and has its own file.
 */

const chip = (id: string, label: string, extra: Partial<ReturnType<typeof itemOf>> = {}) =>
  itemOf({ id, kind: "entry", title: label, entry: { label, qualifier: null }, ...extra });

const aProfile = (): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 2,
  experience: [
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
      children: [
        itemOf({
          id: "project",
          kind: "project",
          title: "Opendidac",
          project: { description: "An educational platform.", datesText: "since 2022" },
          children: [chip("chip", "Kubernetes")],
        }),
      ],
    }),
  ],
  groups: [
    itemOf({
      id: "group",
      kind: "group",
      title: "DevOps and cloud",
      children: [
        chip("k8s", "Kubernetes", {
          question: questionOf({ id: "q1", itemId: "k8s", lead: "Which was it?" }),
        }),
        chip("docker", "Docker"),
        chip("terraform", "Terraform", {
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
  ],
});

const rendered = async (focused: boolean, selected: string | null) => {
  const fixture = TestBed.createComponent(ProfileSheet);
  fixture.componentRef.setInput("profile", aProfile());
  fixture.componentRef.setInput("focused", focused);
  fixture.componentRef.setInput("selected", selected);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    element,
    sheet: element.querySelector<HTMLElement>("article"),
    regionOf: (id: string) => element.querySelector<HTMLElement>(`[data-id="${id}"]`),
  };
};

describe("the overlay (criterion 10, rule 1)", () => {
  it("dims the sheet and captures nothing", async () => {
    const { sheet } = await rendered(true, "k8s");

    expect(sheet?.getAttribute("data-focused")).toBe("true");
    // The overlay is a pseudo-element with `pointer-events: none`, never a sibling with
    // a handler: a `stopPropagation` is precisely what the handoff note forbids.
    expect(sheet?.querySelector("[data-overlay]")).toBeNull();
  });

  it("is not there at all while no tool is open", async () => {
    const { sheet } = await rendered(false, null);

    expect(sheet?.getAttribute("data-focused")).toBeNull();
  });

  /** A press on the sheet itself, and never one that landed on a region. */
  it("says the overlay was pressed when the press landed on the sheet and not a region", async () => {
    const { fixture, sheet, regionOf } = await rendered(true, "k8s");
    const pressed: true[] = [];
    fixture.componentInstance.overlayPressed.subscribe(() => pressed.push(true));

    sheet?.click();
    expect(pressed.length).toBe(1);

    regionOf("docker")?.click();
    expect(pressed.length).toBe(1);
  });
});

describe("what rises above it (criterion 10, rule 2)", () => {
  it("raises the selected region alone, and not what it hangs under", async () => {
    const { regionOf } = await rendered(true, "chip");

    expect(regionOf("chip")?.getAttribute("data-selected")).toBe("true");
    expect(regionOf("project")?.getAttribute("data-selected")).toBeNull();
    expect(regionOf("post")?.getAttribute("data-selected")).toBeNull();
  });
});

describe("the hover rule (criterion 10, rule 3)", () => {
  it("carries the prototype's own selector, so only the innermost region lights", async () => {
    const { regionOf } = await rendered(false, null);

    // `:hover:not(:has(.region:hover))`, as Tailwind writes it. A `mouseenter` handler
    // with `stopPropagation` looks equivalent and breaks on a pointer that enters two
    // regions in one move, so there is no pointer listener anywhere in the sheet.
    expect(regionOf("chip")?.className).toContain("hover:not-has-[.region:hover]");
    expect(regionOf("chip")?.className).toContain("region");
  });
});

describe("the mark and the check line", () => {
  it("marks the item a question waits on, with the word beside it", async () => {
    const { regionOf } = await rendered(false, null);

    const marked = regionOf("k8s");
    expect(marked?.querySelector("[data-part=ask]")).not.toBeNull();
    expect(marked?.querySelector("[data-part=askword]")?.textContent?.trim()).toBe(
      "scope to clarify",
    );
    expect(regionOf("docker")?.querySelector("[data-part=ask]")).toBeNull();
  });

  it("shows the concern under an answered item, and takes the mark away", async () => {
    const { regionOf } = await rendered(false, null);

    const answered = regionOf("terraform");
    expect(answered?.querySelector("[data-part=concern]")?.textContent?.trim()).toBe(
      "✓ Terraform: covered in a course, never production",
    );
    expect(answered?.querySelector("[data-part=ask]")).toBeNull();
  });
});
