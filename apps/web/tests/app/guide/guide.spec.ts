import { signal } from "@angular/core";
import { describe, expect, it } from "vitest";
import { guide, pause, type Step } from "../../../src/app/guide/guide";
import { atOnce, type GuidePace } from "../../../src/app/guide/pace";
import { doThis, say, show, shownOf } from "../../../src/app/guide/say";

/**
 * The guided effects (`2026-09-13-guided-effects.spec.md`), seams A and B.
 *
 * Every case below runs at a real pace or at zero, and never in between: what the suite
 * asks of a sequence is its end state and its order, never its wall-clock time. A test
 * that slept would be a test that flakes on a slow machine.
 */

const quick: GuidePace = { perMessageMs: 40, firstBeatMs: 0 };

const host = () => document.createElement("div");

const settled = async (ms = 200) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("guide", () => {
  it("runs the steps in order, and says which one it is on", async () => {
    const order: string[] = [];
    const step = (name: string): Step => ({
      name,
      run: async () => {
        order.push(name);
      },
    });
    const on = host();

    guide([step("first"), step("second"), step("third")], on);
    await settled(20);

    expect(order).toEqual(["first", "second", "third"]);
    expect(on.getAttribute("data-guide")).toBe("done");
  });

  it("stops when the person does something, and the step lands its end state anyway", async () => {
    const landed = signal(0);
    const on = host();
    const text = "I read your one document and wrote nothing that is not in it";

    guide([say("opener", text, landed, { perMessageMs: 2000, firstBeatMs: 0 })], on);
    await settled(30);
    expect(landed()).toBeLessThan(text.split(" ").length);

    on.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await settled(30);

    // Abandoning the performance never abandons the content (`G2`).
    expect(landed()).toBe(text.split(" ").length);
    expect(shownOf(text, landed())).toBe(text);
  });

  it("skips the steps after the one that was interrupted", async () => {
    const first = signal(0);
    const second = signal(false);
    const on = host();

    guide(
      [
        say("opener", "one two three four five six seven eight", first, {
          perMessageMs: 2000,
          firstBeatMs: 0,
        }),
        show("card", second, { perMessageMs: 2000, firstBeatMs: 0 }),
      ],
      on,
    );
    await settled(30);
    on.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await settled(60);

    expect(first()).toBe(8);
    // The later step still lands: what is abandoned is the performing, not the screen.
    expect(second()).toBe(true);
  });

  it("lands everything at once when the pace is zero, without waiting", async () => {
    const landed = signal(0);
    const card = signal(false);
    const opened = signal(false);
    const on = host();

    guide(
      [
        say("opener", "one two three four", landed, atOnce),
        show("card", card, atOnce),
        doThis("open", () => opened.set(true), atOnce),
      ],
      on,
    );
    await settled(5);

    expect(landed()).toBe(4);
    expect(card()).toBe(true);
    expect(opened()).toBe(true);
    expect(on.getAttribute("data-guide")).toBe("done");
  });

  it("keeps a message whole: what lands is what was given, word for word", async () => {
    const landed = signal(0);
    const text = "Some facts say what you did but not what your part was";
    const on = host();

    guide([say("tail", text, landed, quick)], on);
    await settled(200);

    expect(shownOf(text, landed())).toBe(text);
  });

  it("shows a message a word at a time on the way", () => {
    const text = "First, Kubernetes.";

    expect(shownOf(text, 0)).toBe("");
    expect(shownOf(text, 1)).toBe("First,");
    expect(shownOf(text, 2)).toBe("First, Kubernetes.");
  });
});

describe("pause", () => {
  it("ends early when the sequence is abandoned", async () => {
    const controller = new AbortController();
    const began = Date.now();
    const waiting = pause(5000, controller.signal);
    controller.abort();
    await waiting;

    expect(Date.now() - began).toBeLessThan(200);
  });
});
