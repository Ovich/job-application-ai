import { InjectionToken } from "@angular/core";

/**
 * How fast a guided sequence performs (`G4`, `G7`).
 *
 * **A budget, not a speed.** One message lands within `perMessageMs` whatever its
 * length: the beats are spread across the time it needs, so a long paragraph does not
 * punish the reader and a short one still feels alive. Nothing configures words per
 * second anywhere, because a speed chosen for one sentence is wrong for the next.
 */
export type GuidePace = {
  /** The longest one message may take to land. `0` lands everything at once (`G7`). */
  perMessageMs: number;

  /** The pause before the first beat, where a real answer spends its latency. */
  firstBeatMs: number;
};

/**
 * The pace the application runs at. **The suite provides zero** (`G7`), the same trick
 * that keeps the AI mock's own pace out of the tests (`SL1`, spec `D13`): a test asks
 * for the end state and never waits on theatre.
 */
export const GUIDE_PACE = new InjectionToken<GuidePace>("the guide's pace", {
  providedIn: "root",
  // Faster than the ceiling `G4` allows, on the person's word, 2026-09-13: two
  // seconds is what a message may *never exceed*, not what it should take.
  factory: (): GuidePace => ({ perMessageMs: 900, firstBeatMs: 120 }),
});

/** Nothing performs: every step lands at once. What the suite is given, and what a
 * person who asked for reduced motion is given (`G6`). */
export const atOnce: GuidePace = { perMessageMs: 0, firstBeatMs: 0 };
