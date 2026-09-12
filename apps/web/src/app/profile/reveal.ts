/**
 * Bringing one region of the profile to the middle of its own column (`ID125`, rules 4
 * and 5, the mockup's handoff note).
 *
 * **It moves the column's own `scrollTop` and nothing else.** `scrollIntoView` is not
 * used and the reason is written in the handoff note: the column scrolls inside the
 * shell, so `scrollIntoView` would also move whatever contains it, which inside a frame
 * or on a phone moves the wrong thing. The arithmetic is therefore against the column's
 * own `getBoundingClientRect`, never the viewport's.
 *
 * **The placement is redone until the person scrolls.** A column measured before it has
 * its height — inside a frame, or before the fonts land — places the region at the top
 * instead of the middle, so a `ResizeObserver` redoes it, without animation, until a
 * wheel or a touch says the person has taken the column over.
 *
 * It reads no document-level state and holds no reference to a component: the column and
 * the region arrive as elements. What it earns is the deletion test — delete it and the
 * offset arithmetic, the observer and the two listeners reappear in every component that
 * opens a tool, which is two of them by `SL5`.
 */

/** How long a reveal takes, and the prototype's own figure (the handoff note). */
const OVER_200_MS = 200;

/** What is being kept in view in one column, and what is watching on its behalf. */
type Following = {
  region: HTMLElement | null;
  scrolledByHand: boolean;
  animation: number | null;
  stop: () => void;
};

const following = new WeakMap<HTMLElement, Following>();

/** Cubic in-out, the prototype's own easing. */
const ease = (at: number): number => (at < 0.5 ? 4 * at * at * at : 1 - (-2 * at + 2) ** 3 / 2);

const instantly = (): boolean => {
  try {
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A runtime with no `matchMedia` has no preference to honour, and a reveal that
    // threw here would be a screen that never scrolled.
    return false;
  }
};

const watching = (column: HTMLElement): Following => {
  const already = following.get(column);
  if (already !== undefined) return already;

  const scrolledByHand = () => {
    const state = following.get(column);
    if (state !== undefined) state.scrolledByHand = true;
  };
  column.addEventListener("wheel", scrolledByHand, { passive: true });
  column.addEventListener("touchmove", scrolledByHand, { passive: true });

  // A runtime with no `ResizeObserver` has no settling to redo, and a reveal that threw
  // here would be a screen that never scrolled — the same trade `instantly()` makes
  // above for a runtime with no `matchMedia`.
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const state = following.get(column);
          if (state === undefined || state.region === null || state.scrolledByHand) return;
          place(column, state.region, 0);
        });
  observer?.observe(column);

  const state: Following = {
    region: null,
    scrolledByHand: false,
    animation: null,
    stop: () => {
      observer?.disconnect();
      column.removeEventListener("wheel", scrolledByHand);
      column.removeEventListener("touchmove", scrolledByHand);
    },
  };
  following.set(column, state);
  return state;
};

/** The column moved to that offset, clamped, over that long. Nothing else moves. */
const scrollColumnTo = (column: HTMLElement, wanted: number, ms: number): void => {
  const state = watching(column);
  const to = Math.max(0, Math.min(wanted, column.scrollHeight - column.clientHeight));
  const from = column.scrollTop;
  const distance = to - from;
  if (state.animation !== null) cancelAnimationFrame(state.animation);
  state.animation = null;
  if (Math.abs(distance) < 2) return;
  if (ms <= 0 || instantly()) {
    column.scrollTop = to;
    return;
  }
  const started = performance.now();
  const step = (now: number): void => {
    const through = Math.min(1, (now - started) / ms);
    column.scrollTop = from + distance * ease(through);
    if (through < 1) {
      state.animation = requestAnimationFrame(step);
      return;
    }
    state.animation = null;
    column.scrollTop = to;
  };
  state.animation = requestAnimationFrame(step);
};

/** Where the region's middle sits against the column's own rect. */
const place = (column: HTMLElement, region: HTMLElement, ms: number): void => {
  const held = column.getBoundingClientRect();
  const its = region.getBoundingClientRect();
  scrollColumnTo(
    column,
    its.top - held.top + column.scrollTop - (column.clientHeight - its.height) / 2,
    ms,
  );
};

/**
 * That region, brought to the middle of that column, and kept there while the column
 * settles at its real size.
 */
export const revealInColumn = (
  column: HTMLElement,
  region: HTMLElement,
  ms = OVER_200_MS,
): void => {
  const state = watching(column);
  state.region = region;
  state.scrolledByHand = false;
  // What this column is following, written on the column itself. The offset is layout,
  // which no runtime without layout has; which of the two placements was asked for is a
  // fact, and a screen that went to its head when it should have stayed is exactly the
  // regression a person reports and nothing else can see.
  column.setAttribute("data-at", "region");
  place(column, region, ms);
};

/**
 * Back to the head of the profile, with nothing left to keep in view.
 *
 * This is what the assistant's own run ending does: the reading is what the person came
 * to see, and the last question left them deep inside a list (`ID125`, rule 5).
 */
export const backToHead = (column: HTMLElement, ms = OVER_200_MS): void => {
  const state = watching(column);
  state.region = null;
  column.setAttribute("data-at", "head");
  scrollColumnTo(column, 0, ms);
};

/** The column is going away: the observer and the two listeners go with it. */
export const stopFollowing = (column: HTMLElement): void => {
  const state = following.get(column);
  if (state === undefined) return;
  if (state.animation !== null) cancelAnimationFrame(state.animation);
  state.stop();
  column.removeAttribute("data-at");
  following.delete(column);
};
