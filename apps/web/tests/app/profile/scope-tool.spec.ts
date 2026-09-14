import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { ScopeTool } from "../../../src/app/profile/scope-tool/scope-tool";

/**
 * Seam D: `profile/scope-tool`, rendered (criteria 5, 6, 8).
 *
 * Behind it: nothing at all. The question comes in as an input and what the person does
 * leaves as an output, so this file asserts rendered rows and emitted events and reaches
 * past neither.
 *
 * Not past it: what a rule does once saved, which is seam B's, and the look, which is
 * reviewed against the mockup (`👤 design review`).
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const aQuestion = {
  kind: "asked",
  where: "What you work with · DevOps and cloud · in 2 documents",
  lead: "Kubernetes is in two of your documents and neither says your part. Which was it?",
  options: [
    {
      id: "a",
      label: "Ran the cluster",
      hint: "nodes, upgrades, access",
      rule: "Kubernetes: cluster administration, and the services on it",
    },
    {
      id: "b",
      label: "Ran services on it",
      hint: "deployed and operated the workloads",
      rule: "Kubernetes: deploying and running services, never cluster administration",
    },
    {
      id: "c",
      label: "Used it as a developer",
      hint: "shipped to a cluster someone else ran",
      rule: "Kubernetes: shipping to a cluster run by others",
    },
    { id: "own", label: "Something else", hint: "say it below", rule: null },
  ],
} as const;

const rendered = async (
  tool:
    | typeof aQuestion
    | { kind: "asked"; where: string; lead: string; options: readonly unknown[] }
    | { kind: "clarification"; where?: string },
) => {
  const fixture = TestBed.createComponent(ScopeTool);
  fixture.componentRef.setInput("tool", tool);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(element.querySelectorAll<HTMLButtonElement>("[data-action=alt]"));
  return { fixture, element, rows };
};

describe("the answers, as rows (criterion 5)", () => {
  it("draws every answer as a row of two lines, and nothing is preselected", async () => {
    const { element, rows } = await rendered(aQuestion);

    expect(rows().length).toBe(4);
    expect(rows().map((row) => textOf(row.querySelector("[data-part=label]")))).toEqual([
      "Ran the cluster",
      "Ran services on it",
      "Used it as a developer",
      "Something else",
    ]);
    expect(rows().map((row) => textOf(row.querySelector("small")))).toEqual([
      "nodes, upgrades, access",
      "deployed and operated the workloads",
      "shipped to a cluster someone else ran",
      "say it below",
    ]);
    expect(rows().every((row) => row.getAttribute("aria-pressed") === "false")).toBe(true);
    // Where the question sits is the composer's to show now (the person, 2026-09-14).
    expect(element.querySelector("[data-part=where]")).toBeNull();
    expect(textOf(element.querySelector("[data-part=lead]"))).toBe(aQuestion.lead);
  });

  it("keeps the person's own words as the last row when the reader proposed three", async () => {
    const { rows } = await rendered({
      kind: "asked",
      where: "Experience · HEIG-VD · 2 documents disagree",
      lead: "Which was on your contract?",
      options: [
        { id: "a", label: "Assistant HES", hint: "the 2022 CV", rule: "HEIG-VD: Assistant HES" },
        { id: "own", label: "Something else", hint: "say it below", rule: null },
      ],
    });

    expect(rows().length).toBe(2);
    expect(textOf(rows().at(-1)?.querySelector("[data-part=label]"))).toBe("Something else");
    expect(rows().at(-1)?.getAttribute("data-own")).toBe("1");
  });

  it("marks the picked row alone, and says so once", async () => {
    const { fixture, rows } = await rendered(aQuestion);
    const picked: { optionId: string }[] = [];
    fixture.componentInstance.pick.subscribe((event) => picked.push(event));

    rows()[1]?.click();
    await fixture.whenStable();

    expect(picked).toEqual([{ optionId: "b" }]);
    expect(rows().map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
  });

  it("says the own-words row is the person's own, and carries no rule of its own", async () => {
    const { fixture, rows } = await rendered(aQuestion);
    const picked: { optionId: string }[] = [];
    fixture.componentInstance.pick.subscribe((event) => picked.push(event));

    rows()[3]?.click();
    await fixture.whenStable();

    expect(picked).toEqual([{ optionId: "own" }]);
    expect(rows()[3]?.getAttribute("data-rule")).toBeNull();
  });
});

/**
 * `SL5`'s second shape: the tool the person opened themselves. It proposes nothing at
 * all, and the input is what makes that so — a `clarification` carries no option to
 * render, so a suggested answer is unrepresentable rather than merely absent.
 */
describe("the tool the person opened themselves (SL5, criteria 1 and 3)", () => {
  it("renders one fixed sentence, the foot line and nothing else: no option anywhere", async () => {
    const { element, rows } = await rendered({ kind: "clarification", where: "" });

    expect(textOf(element.querySelector("[data-part=lead]"))).toBe(
      "Tell me what I should know about it, in your own words.",
    );
    expect(rows()).toHaveLength(0);
    expect(element.querySelector("fieldset")).toBeNull();
    expect(element.querySelector("[data-action=skip]")).toBeNull();
    expect(textOf(element.querySelector("[data-part=foot]"))).toContain(
      "What you write is kept as your rule for it.",
    );
  });

  it("names nothing: the clicked thing's own text is the prefix's, and the tool says where it is not", async () => {
    const { element } = await rendered({ kind: "clarification", where: "" });

    // The one fixed sentence says "it", never what "it" is. A tool that composed
    // "Your part in Kubernetes at Nestlé" would be inferring, in a smaller place.
    expect(element.querySelector("[data-part=where]")).toBeNull();
    expect(textOf(element)).not.toContain("Kubernetes");
  });

  /**
   * One way out, and the tool is not it (the person, 2026-09-13): the prefix's × closes
   * whatever is open. A tool carrying its own Cancel beside a chip that also closes it
   * asks a person to learn two gestures for one thing and to wonder whether they differ.
   */
  it("offers no way out of its own: closing is the prefix's", async () => {
    const { element } = await rendered({ kind: "clarification", where: "Kubernetes · row 1" });

    expect(element.querySelector("[data-action=cancel]")).toBeNull();
    expect(textOf(element)).not.toContain("Cancel");
  });
});

describe("the foot (criterion 8)", () => {
  it("offers the skip in the builder's own words", async () => {
    const { fixture, element } = await rendered(aQuestion);
    const skipped: true[] = [];
    fixture.componentInstance.skip.subscribe(() => skipped.push(true));

    const skip = element.querySelector<HTMLButtonElement>("[data-action=skip]");
    expect(textOf(skip)).toBe("Skip, ask me in the builder");
    expect(textOf(element.querySelector("[data-part=foot]"))).toContain(
      "Pick one, or say it in your own words below.",
    );

    skip?.click();
    expect(skipped.length).toBe(1);
  });
});
