import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { Composer } from "../../../src/app/assistant/composer/composer";

/**
 * The core composer, rendered: one line or many, and one button (the person, 2026-09-14).
 *
 * Behind it: nothing. The tool comes in as an input and a commit leaves as `save`, so
 * this file presses keys and reads what a person would see — which field is there, where
 * the path sits, what the one button is called — and reaches past neither.
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const aTool = {
  label: "Adjusting scope",
  describes: "What you tell me here is kept as a rule on that part of your profile.",
  where: "R&D Collaborator in Software Engineering · row 1",
};

const rendered = async (tool: typeof aTool | null = aTool) => {
  const fixture = TestBed.createComponent(Composer);
  fixture.componentRef.setInput("tool", tool);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const at = (selector: string) => element.querySelector(selector);
  const field = () => at("[data-part=composer]") as HTMLInputElement | HTMLTextAreaElement;
  const sent: unknown[] = [];
  fixture.componentInstance.save.subscribe(() => sent.push("save"));
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Types into whichever field is showing, the caret left at the end. */
  const type = async (text: string) => {
    const target = field();
    target.value = text;
    target.setSelectionRange(text.length, text.length);
    target.dispatchEvent(new Event("input"));
    await settle();
  };
  const enter = async (init: KeyboardEventInit = {}) => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }),
    );
    await settle();
  };
  return { fixture, at, field, type, enter, sent };
};

describe("the composer on one line", () => {
  it("is a single line, with the path between the tool and the bar", async () => {
    const { at } = await rendered();

    expect(at("input[data-part=composer]")).not.toBeNull();
    expect(at("textarea")).toBeNull();
    expect(textOf(at("[data-part=where]"))).toBe(aTool.where);
    expect(at("[data-part=bar] [data-part=where]")).toBeNull();
  });

  it("commits on Enter", async () => {
    const { type, enter, sent } = await rendered();

    await type("I only ever wrote the Dockerfiles");
    await enter();

    expect(sent).toEqual(["save"]);
  });

  it("commits nothing on Enter when there is nothing to commit", async () => {
    const { enter, sent } = await rendered();

    await enter();

    expect(sent).toEqual([]);
  });

  it("leaves an Enter that belongs to an input method alone", async () => {
    const { type, enter, sent } = await rendered();

    await type("日本");
    await enter({ isComposing: true });

    expect(sent).toEqual([]);
  });
});

describe("the composer on many lines", () => {
  it("opens above the bar on Alt+Enter, the line gone and the prefix and the button kept", async () => {
    const { at, field, type, enter, sent } = await rendered();

    await type("First thought");
    await enter({ altKey: true });

    expect(sent).toEqual([]);
    expect(at("textarea[data-part=composer]")).not.toBeNull();
    expect(at("input[data-part=composer]")).toBeNull();
    expect(field().value).toBe("First thought\n");
    expect(at("[data-part=bar] tool-prefix")).not.toBeNull();
    expect(at("[data-part=bar] [data-part=send]")).not.toBeNull();
  });

  it("moves the path into the bar, between the prefix and the button", async () => {
    const { at, type, enter } = await rendered();

    await type("First thought");
    await enter({ altKey: true });

    expect(textOf(at("[data-part=bar] [data-part=where]"))).toBe(aTool.where);
    // Moved, not copied: the line between the tool and the bar is gone.
    expect(at(":scope > [data-part=where]")).toBeNull();
  });

  it("still commits on Enter, without breaking the line", async () => {
    const { field, type, enter, sent } = await rendered();

    await type("First thought");
    await enter({ altKey: true });
    await type("First thought\nand a second");
    await enter();

    expect(sent).toEqual(["save"]);
    expect(field().value).toBe("First thought\nand a second");
  });

  // The two cases that end on one line say first that they had left it: a composer that
  // never opened many lines is already on one, and would pass them without doing either.
  it("goes back to one line when everything is deleted", async () => {
    const { at, type, enter } = await rendered();

    await type("First thought");
    await enter({ altKey: true });
    expect(at("textarea[data-part=composer]")).not.toBeNull();
    await type("");

    expect(at("input[data-part=composer]")).not.toBeNull();
    expect(at("textarea")).toBeNull();
  });

  it("stays on many lines when only the line break is deleted", async () => {
    const { at, type, enter } = await rendered();

    await type("First thought");
    await enter({ altKey: true });
    await type("First thought");

    expect(at("textarea[data-part=composer]")).not.toBeNull();
  });

  it("goes back to one line once what was written has been saved", async () => {
    const { fixture, at, type, enter } = await rendered();

    await type("First thought");
    await enter({ altKey: true });
    expect(at("textarea[data-part=composer]")).not.toBeNull();
    fixture.componentInstance.clearDraft();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(at("input[data-part=composer]")).not.toBeNull();
  });
});

describe("the one button (the person, 2026-09-14)", () => {
  it("is an icon, named for what it does, with a tool open", async () => {
    const { at } = await rendered();
    const button = at("[data-part=send]");

    expect(textOf(button)).toBe("");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Save");
  });

  it("is the same icon, named Send, with nothing open", async () => {
    const { at } = await rendered(null);
    const button = at("[data-part=send]");

    expect(textOf(button)).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Send");
    expect(at("[data-part=where]")).toBeNull();
  });
});
