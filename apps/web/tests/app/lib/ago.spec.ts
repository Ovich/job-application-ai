import { describe, expect, it } from "vitest";
import { ago, exactly } from "../../../src/app/lib/ago";

/**
 * Seam D: `app/lib/ago`, when a message was written, said the way a person says it
 * (agent-consolidation `S8.3b`, `ID220`).
 *
 * Behind it: nothing but `Intl`. `now` is handed in by each case, so no case reads the
 * clock and none depends on the day it runs.
 */

/** Monday 14 September 2026, noon, in the runtime's own time zone. */
const now = new Date(2026, 8, 14, 12, 0, 0);

const before = (ms: number): Date => new Date(now.getTime() - ms);

const minute = 60 * 1000;

describe("ago (S8.3b, ID220)", () => {
  it.each([
    ["under a minute", before(30 * 1000), "just now"],
    ["five minutes", before(5 * minute), "5 min ago"],
    ["fifty-nine minutes", before(59 * minute), "59 min ago"],
    ["two hours", before(2 * 60 * minute), "2 h ago"],
    ["the day before", new Date(2026, 8, 13, 10, 0, 0), "yesterday"],
    ["three days", new Date(2026, 8, 11, 12, 0, 0), "11 Sep"],
    ["last year", new Date(2025, 8, 12, 12, 0, 0), "12 Sep 2025"],
  ])("says %s as a person would", (_, at, said) => {
    expect(ago(at, now)).toBe(said);
  });

  it("says a time in the future is just now, never a negative phrase", () => {
    expect(ago(new Date(now.getTime() + 5 * minute), now)).toBe("just now");
  });
});

describe("exactly (S8.3b, ID220)", () => {
  it("says the full date and the time", () => {
    expect(exactly(new Date(2026, 8, 14, 9, 5, 0))).toBe("14 September 2026, 09:05");
  });
});
