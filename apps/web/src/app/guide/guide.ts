/**
 * Guided effects: the interface performing what it wants a person to understand, once,
 * in the order it happens (`2026-09-13-guided-effects.spec.md`).
 *
 * **This module knows no use case.** It runs named steps in order and gets out of the
 * way; what the steps *are* belongs to the screen that declares them, the same division
 * the assistant holds to (`ID149`).
 */

/** One named thing a sequence does. It finishes, or it is abandoned mid-way. */
export type Step = {
  name: string;
  /** Perform it. On `signal.aborted` it must land its own end state and return. */
  run: (signal: AbortSignal) => Promise<void>;
};

/** What a person did that means "stop performing and let me work" (`G2`). */
const interruptions = ["keydown", "pointerdown", "wheel"] as const;

/**
 * Runs the steps in order, and stops the moment the person does anything (`G2`).
 *
 * **Abandoning is not cancelling.** Every step is handed the signal and is required to
 * land its end state when it sees it aborted, so what a person interrupts is the
 * *performance* and never the content: the words are all there, the tool is open, the
 * column has moved. A guide that left half a sentence on the screen would be worse than
 * no guide at all.
 *
 * The host carries `data-guide` with the running step's name, and `done` at the end
 * (`G8`) — the only way a runtime without layout can see that a sequence ran, which is
 * how the reveal bug of 2026-09-13 was caught at all.
 */
export const guide = (steps: Step[], host: HTMLElement): AbortController => {
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
  };
  for (const event of interruptions) {
    host.addEventListener(event, stop, { passive: true });
  }

  void (async () => {
    try {
      for (const step of steps) {
        host.setAttribute("data-guide", step.name);
        await step.run(controller.signal);
      }
    } finally {
      host.setAttribute("data-guide", "done");
      for (const event of interruptions) host.removeEventListener(event, stop);
    }
  })();

  return controller;
};

/** A pause that ends early when the sequence is abandoned. */
export const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  ms <= 0 || signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", done);
          resolve();
        }, ms);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener("abort", done, { once: true });
      });
