import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionAnsweredPart } from "../../../../src/app/profile/parts/question-answered-part/question-answered-part";
import { QuestionSkippedPart } from "../../../../src/app/profile/parts/question-skipped-part/question-skipped-part";
import { type Entry, resetIntake } from "../../../support/intake";
import { reset } from "../../../support/session";

/**
 * The whole exchange, at a glance (agent-consolidation `S7.6`, the person from localhost:
 * "the question, the selected option + additional chat text"): each part, rendered alone
 * with a stored part as the conversation hands it over. What is asserted is what a
 * person reads.
 */

type Part = Entry["parts"][number];

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  reset();
  resetIntake();
});

afterEach(() => {
  reset();
  resetIntake();
});

const asked = {
  lead: "Which was it?",
  where: "What you work with · DevOps and cloud",
  options: [
    { id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" },
    { id: "q1-2", label: "Ran services on it", hint: "deployed and operated the workloads" },
  ],
};

const drawn = async (component: Type<unknown>, part: Part): Promise<string> => {
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput("part", part);
  await fixture.whenStable();
  return textOf(fixture.nativeElement as HTMLElement);
};

describe("an answer, the whole exchange (S7.6)", () => {
  it("shows the question as asked, where it is, the option picked and the person's words", async () => {
    const said = await drawn(QuestionAnsweredPart, {
      kind: "question_answered",
      ...asked,
      picked: "q1-2",
      words: "three clusters, one on bare metal",
    });

    expect(said).toContain("Which was it?");
    expect(said).toContain("What you work with · DevOps and cloud");
    expect(said).toContain("Ran services on it");
    expect(said).toContain("three clusters, one on bare metal");
    expect(said).not.toContain("Ran the cluster");
  });
});

describe("a skip, the whole exchange (S7.6)", () => {
  it("shows the question as asked, where it is, and that it was skipped", async () => {
    const said = await drawn(QuestionSkippedPart, { kind: "question_skipped", ...asked });

    expect(said).toContain("Which was it?");
    expect(said).toContain("What you work with · DevOps and cloud");
    expect(said).toMatch(/skipped/i);
  });
});
