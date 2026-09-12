import { vi } from "vitest";

/**
 * The suite's own support for the profile's left column and the sheet under it
 * (`ID129`, on `session.ts`'s precedent).
 *
 * It hides two things a case must not spell out. **A scrolling column with a real
 * height and regions with real rects**, because the reveal is measured: a jsdom element
 * has no layout, every placement is then zero, and a case about the middle of a column
 * passes for the wrong reason. And **the two browser things jsdom does not have**, a
 * `ResizeObserver` and `matchMedia`, handed back so a case can fire a resize or ask for
 * reduced motion rather than reach for a global.
 *
 * It asserts nothing and renders nothing: `TestBed` stays in the spec, where what is
 * being rendered is the point.
 */

/** One region in the column: where it sits from the column's top, and how tall it is. */
export type RegionSpec = { top: number; height: number };

/** What a case drives the column with. Nothing here reaches a component. */
export type RenderedColumn = {
  column: HTMLElement;
  /** The region at that position, as an element with a rect a reveal can measure. */
  regionAt: (at: number) => HTMLElement;
  /** The column changed size: what a `ResizeObserver` would report. */
  resizes: () => void;
  /** The person scrolled it themselves, with a wheel. */
  scrolledByHand: () => void;
  dispose: () => void;
};

/** Whether `prefers-reduced-motion: reduce` matches, for the length of one case. */
let reducedMotion = false;

export const prefersReducedMotion = (wanted: boolean): void => {
  reducedMotion = wanted;
};

/** Every `ResizeObserver` this support handed out, so a case can fire one. */
const observers: (() => void)[] = [];

/**
 * A scrolling column of a given height, with regions at given offsets.
 *
 * The column's `clientHeight`, `scrollHeight` and rect are defined here rather than laid
 * out, and each region's rect is computed from the column's own scroll position, which
 * is exactly what a browser does and what the arithmetic under test reads.
 */
export const aColumnOf = (height: number, regions: RegionSpec[]): RenderedColumn => {
  const column = document.createElement("div");
  column.style.overflow = "auto";
  document.body.append(column);

  const content = regions.reduce(
    (tallest, region) => Math.max(tallest, region.top + region.height),
    0,
  );
  let scrollTop = 0;
  Object.defineProperty(column, "clientHeight", { get: () => height, configurable: true });
  Object.defineProperty(column, "scrollHeight", { get: () => content, configurable: true });
  Object.defineProperty(column, "scrollTop", {
    get: () => scrollTop,
    set: (to: number) => {
      scrollTop = to;
    },
    configurable: true,
  });
  column.getBoundingClientRect = () => asRect(0, height);

  const elements = regions.map((region) => {
    const element = document.createElement("div");
    element.className = "region";
    column.append(element);
    element.getBoundingClientRect = () => asRect(region.top - scrollTop, region.height);
    return element;
  });

  const originalObserver = globalThis.ResizeObserver;
  const originalMatchMedia = globalThis.matchMedia;
  const before = observers.length;

  globalThis.ResizeObserver = class {
    constructor(told: () => void) {
      observers.push(told);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  globalThis.matchMedia = ((query: string) =>
    ({
      matches: /prefers-reduced-motion/.test(query) && reducedMotion,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof matchMedia;

  return {
    column,
    regionAt: (at) => {
      const element = elements[at];
      if (element === undefined) throw new Error(`the column has no region at ${at}`);
      return element;
    },
    resizes: () => {
      for (const told of observers.slice(before)) told();
    },
    scrolledByHand: () => {
      column.dispatchEvent(new Event("wheel"));
    },
    dispose: () => {
      column.remove();
      observers.length = before;
      globalThis.ResizeObserver = originalObserver;
      globalThis.matchMedia = originalMatchMedia;
      reducedMotion = false;
    },
  };
};

const asRect = (top: number, height: number): DOMRect =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * The clock the animation runs on, faked so 200 ms is a number a case can assert rather
 * than a wait. `performance.now` and the two frame calls are faked together: the
 * animation reads one and schedules on the other, and faking half of that pair would
 * leave a loop that never advances.
 */
export const theClockFaked = (): void => {
  vi.useFakeTimers({
    toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame", "Date"],
  });
};

export const theClockReal = (): void => {
  vi.useRealTimers();
};
