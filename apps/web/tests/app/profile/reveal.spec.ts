import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backToHead, revealInColumn, stopFollowing } from "../../../src/app/profile/reveal";
import {
  aColumnOf,
  prefersReducedMotion,
  type RenderedColumn,
  theClockFaked,
  theClockReal,
} from "../../support/profile";

/**
 * Seam E, the half of it that is arithmetic: `profile/reveal` (criterion 10, rule 4).
 *
 * Behind it: nothing but the DOM and a stubbed clock. The column is given a height and
 * the regions real rects by the suite's own support, because the placement is measured
 * — a jsdom element with no layout makes every placement zero and the case would pass
 * for the wrong reason.
 *
 * **The invariant this file exists for**: it moves the column's own `scrollTop` and
 * nothing else. `scrollIntoView` would also move whatever contains the column, which in
 * a frame or on a phone moves the wrong thing.
 */

/** A column 400 tall over 2000 of content, with a region 100 tall at 900. */
const aColumn = (): RenderedColumn =>
  aColumnOf(400, [
    { top: 0, height: 100 },
    { top: 900, height: 100 },
    { top: 1900, height: 100 },
  ]);

/** The middle of the column for the region at 900: 900 − (400 − 100) / 2. */
const theMiddle = 900 - (400 - 100) / 2;

let column: RenderedColumn;

beforeEach(() => {
  theClockFaked();
  column = aColumn();
});

afterEach(() => {
  stopFollowing(column.column);
  column.dispose();
  theClockReal();
  vi.restoreAllMocks();
});

describe("the reveal (criterion 10, rule 4)", () => {
  it("brings the region to the middle of the column, and moves nothing else", async () => {
    const above = document.createElement("div");
    document.body.append(above);
    above.scrollTop = 0;
    const intoView = vi.fn();
    column.regionAt(1).scrollIntoView = intoView;

    revealInColumn(column.column, column.regionAt(1));
    // The animation settles on the first frame at or after its 200 ms, which is what a
    // browser does too, so the case waits one frame past the end for the exact landing.
    vi.advanceTimersByTime(220);

    expect(column.column.scrollTop).toBe(theMiddle);
    expect(above.scrollTop).toBe(0);
    expect(intoView).not.toHaveBeenCalled();
    above.remove();
  });

  it("takes 200 ms over it, and is not there before", async () => {
    revealInColumn(column.column, column.regionAt(1));

    vi.advanceTimersByTime(100);
    const halfway = column.column.scrollTop;
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(theMiddle);

    // At its 200 ms it is there, to within the fraction of a pixel the last frame before
    // the end leaves; the exact landing is that frame's successor.
    vi.advanceTimersByTime(100);
    expect(column.column.scrollTop).toBeCloseTo(theMiddle, 0);
    vi.advanceTimersByTime(20);
    expect(column.column.scrollTop).toBe(theMiddle);
  });

  it("is instant when the person asked for reduced motion", async () => {
    prefersReducedMotion(true);

    revealInColumn(column.column, column.regionAt(1));

    expect(column.column.scrollTop).toBe(theMiddle);
  });

  it("redoes the placement, without animation, when the column resizes", async () => {
    revealInColumn(column.column, column.regionAt(1));
    vi.advanceTimersByTime(220);
    column.column.scrollTop = 0;

    column.resizes();

    expect(column.column.scrollTop).toBe(theMiddle);
  });

  it("stops following once the person has scrolled it themselves", async () => {
    revealInColumn(column.column, column.regionAt(1));
    vi.advanceTimersByTime(220);
    column.scrolledByHand();
    column.column.scrollTop = 42;

    column.resizes();

    expect(column.column.scrollTop).toBe(42);
  });
});

describe("back to the head (criterion 10, rule 5)", () => {
  it("returns the column to its head and keeps nothing in view", async () => {
    revealInColumn(column.column, column.regionAt(1));
    vi.advanceTimersByTime(220);

    backToHead(column.column);
    vi.advanceTimersByTime(220);

    expect(column.column.scrollTop).toBe(0);

    // And nothing is followed any more: a resize moves the column no further.
    column.column.scrollTop = 30;
    column.resizes();
    expect(column.column.scrollTop).toBe(30);
  });
});
