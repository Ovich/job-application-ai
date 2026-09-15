import type { Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryAnswerPart } from "../../../../src/app/profile/profile-assistant/history/history-answer-part/history-answer-part";
import { HistorySkipPart } from "../../../../src/app/profile/profile-assistant/history/history-skip-part/history-skip-part";
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
    const said = await drawn(HistoryAnswerPart, {
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

/**
 * The person's bubble keeps its colours in either theme (agent-consolidation `S8.6`,
 * `ID232`): the answered part is the send blue with white text and every line in it takes
 * the bubble's colour; the skipped part, which has no bubble, stays on the theme's tokens.
 */
describe("the parts' colours in either theme (S8.6, ID232)", () => {
  /** A colour utility bound to a token the dark palette redefines. */
  const THEME_COLOUR =
    /^(text|bg)-(foreground|background|muted|muted-foreground|card|primary|primary-foreground|accent|accent-foreground)(\/\d+)?$/;

  const rendered = async (component: Type<unknown>, part: Part): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput("part", part);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  const coloursOf = (element: Element | null | undefined): string[] =>
    Array.from(element?.classList ?? []).filter((each) => THEME_COLOUR.test(each));

  it("draws an answer in the send blue with white text, and no line in it follows the theme", async () => {
    const element = await rendered(HistoryAnswerPart, {
      kind: "question_answered",
      ...asked,
      picked: "q1-2",
      words: "three clusters, one on bare metal",
    });

    const bubble = element.querySelector("[data-part=answered]");
    expect(bubble?.classList.contains("bg-send")).toBe(true);
    expect(bubble?.classList.contains("text-white")).toBe(true);
    expect(coloursOf(bubble)).toEqual([]);
    const lines = ["asked", "where", "picked", "words"].map((name) =>
      element.querySelector(`[data-part=${name}]`),
    );
    for (const line of lines) {
      expect(line).not.toBeNull();
      expect(coloursOf(line)).toEqual([]);
    }
  });

  it("leaves a skip, drawn without a bubble, on the theme's tokens", async () => {
    const element = await rendered(HistorySkipPart, { kind: "question_skipped", ...asked });

    const skipped = element.querySelector("[data-part=skipped]");
    expect(skipped?.classList.contains("bg-send")).toBe(false);
    for (const line of Array.from(skipped?.querySelectorAll("p") ?? [])) {
      expect(coloursOf(line)).toEqual(["text-muted-foreground"]);
    }
  });
});

/**
 * Every line in the answer bubble is readable (agent-consolidation `S8.6b`, `ID235`, the
 * person on dev: "part of the greyed text are washed out"): white on the send blue is about
 * 4.6:1, so no line is faded or lighter; the question and where it sits are told apart from
 * the pick by the caption size and a normal weight against the pick's semibold.
 */
describe("every line in the answer bubble is readable (S8.6b, ID235)", () => {
  /** The `text-*` utilities that set a size or an alignment, not a colour. */
  const NOT_A_COLOUR = new Set([
    "text-label",
    "text-caption",
    "text-ui",
    "text-body",
    "text-figure",
    "text-left",
    "text-center",
  ]);
  /** The bubble's own colour, as a line may name it. */
  const BUBBLE_COLOUR = new Set(["text-white", "text-inherit"]);

  const answer = async (): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(HistoryAnswerPart);
    fixture.componentRef.setInput("part", {
      kind: "question_answered",
      ...asked,
      picked: "q1-2",
      words: "three clusters, one on bare metal",
    });
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it("fades no line and gives none a colour other than the bubble's", async () => {
    const element = await answer();
    const bubble = element.querySelector("[data-part=answered]");
    const inside = Array.from(bubble?.querySelectorAll("*") ?? []);
    expect(inside.length).toBeGreaterThan(0);

    for (const each of [bubble, ...inside]) {
      const classes = Array.from(each?.classList ?? []);
      expect(classes.filter((name) => name.startsWith("opacity-"))).toEqual([]);
      expect(
        classes.filter(
          (name) => name.startsWith("text-") && !NOT_A_COLOUR.has(name) && !BUBBLE_COLOUR.has(name),
        ),
      ).toEqual([]);
    }
  });

  it("tells the question and where it sits from the pick by size and weight", async () => {
    const element = await answer();
    const question = element.querySelector("[data-part=asked]");
    const pick = element.querySelector("[data-part=picked]");

    expect(question?.classList.contains("text-caption")).toBe(true);
    expect(question?.classList.contains("font-normal")).toBe(true);
    expect(pick?.classList.contains("font-semibold")).toBe(true);
  });
});

describe("a skip, the whole exchange (S7.6)", () => {
  it("shows the question as asked, where it is, and that it was skipped", async () => {
    const said = await drawn(HistorySkipPart, { kind: "question_skipped", ...asked });

    expect(said).toContain("Which was it?");
    expect(said).toContain("What you work with · DevOps and cloud");
    expect(said).toMatch(/skipped/i);
  });
});
