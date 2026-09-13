import type { WritableSignal } from "@angular/core";
import { pause, type Step } from "./guide";
import type { GuidePace } from "./pace";

/**
 * A message landing beat by beat, the way an answer from a model arrives
 * (`2026-09-13-guided-effects.spec.md`).
 *
 * **What lands is what was already there.** These helpers move a counter; the template
 * decides what a given count shows. Nothing here writes a word, and nothing invents one
 * — the timing is shaped and the content never is (`G1`).
 */

/** How many beats a run of prose is: one per word. */
export const beatsOfWords = (text: string): number => words(text).length;

/** The words of a message, as the template will re-join them. */
export const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/** What a given count of beats shows of a message. */
export const shownOf = (text: string, beats: number): string =>
  words(text).slice(0, Math.max(0, beats)).join(" ");

/**
 * One message of prose, landing a word at a time inside the pace's budget (`G4`).
 *
 * The interval is derived, never configured: the budget divided by the words. A message
 * of four words and a message of forty both take the same wall-clock time, which is
 * what makes the rhythm of a screen predictable.
 */
export const say = (
  name: string,
  text: string,
  landed: WritableSignal<number>,
  pace: GuidePace,
): Step => ({
  name,
  run: async (signal) => {
    const all = beatsOfWords(text);
    if (pace.perMessageMs <= 0 || signal.aborted) {
      landed.set(all);
      return;
    }

    await pause(pace.firstBeatMs, signal);
    const every = pace.perMessageMs / Math.max(all, 1);
    for (let beat = 1; beat <= all; beat += 1) {
      if (signal.aborted) break;
      landed.set(beat);
      await pause(every, signal);
    }
    // Abandoned or finished, the message is whole: a person never keeps half a sentence
    // (`G2`).
    landed.set(all);
  },
});

/**
 * Anything that is not prose — a card, a table, a figure — as **one beat** (`G5`).
 *
 * A graphic animated into existence looks broken rather than alive, so it waits its turn
 * and then simply appears.
 */
export const show = (name: string, shown: WritableSignal<boolean>, pace: GuidePace): Step => ({
  name,
  run: async (signal) => {
    if (pace.perMessageMs > 0 && !signal.aborted) {
      await pause(pace.perMessageMs / 4, signal);
    }
    shown.set(true);
  },
});

/** A step that is not a message at all: open something, move something. One beat. */
export const doThis = (name: string, act: () => void, pace: GuidePace): Step => ({
  name,
  run: async (signal) => {
    if (pace.perMessageMs > 0 && !signal.aborted) {
      await pause(pace.perMessageMs / 4, signal);
    }
    act();
  },
});
