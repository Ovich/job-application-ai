import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { InferResponseType } from "hono/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../lib/api";
import { RunsPage } from "./runs-page";

/**
 * The page that shows the latest run (US3, US6). Two things are its contract, and this
 * file is where they are written down before the page exists (S1.6, S1.6a implements
 * it): a run's units appear in sequence order, and an answer saying no run exists
 * produces an empty state rather than an empty list or an error.
 *
 * The shape of the answer is not declared here. It is read off the client with
 * `InferResponseType`, so the day a column changes this file stops compiling instead
 * of testing a shape the API no longer sends (rule 4).
 *
 * What the page renders is asserted through the DOM a person would see: one list item
 * per unit, its sequence then its status, and the sentence of the empty state. A row
 * may carry more than that; it may not carry less, and it may not carry them in
 * another order.
 */

type LatestRun = InferResponseType<typeof api.runs.latest.$get, 200>;

/** Three units, distinct statuses, so a page that reorders them cannot still pass. */
const run: LatestRun = {
  id: "6f1a5a3e-9b1c-4f2a-9d40-6c2f0b8a1e11",
  kind: "demo",
  createdAt: "2026-09-08T10:00:00.000Z",
  finishedAt: null,
  units: [
    { seq: 1, status: "done", result: "the first unit", doneAt: "2026-09-08T10:00:01.000Z" },
    { seq: 2, status: "failed", result: null, doneAt: "2026-09-08T10:00:02.000Z" },
    { seq: 3, status: "pending", result: null, doneAt: null },
  ],
};

/**
 * The API is reached through the client, so the test stands in for the network and not
 * for the client: the request that leaves is the real one the page's loader made.
 */
function apiAnswers(status: number, body: unknown) {
  const fetching = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetching);
  return fetching;
}

async function renderPage() {
  const fixture = TestBed.createComponent(RunsPage);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

/** Every row's text, whitespace flattened, in the order the document has them. */
function rowsOf(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("li"), (row) =>
    (row.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("RunsPage", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the API for the latest run", async () => {
    const fetching = apiAnswers(200, run);

    await renderPage();

    expect(fetching).toHaveBeenCalledTimes(1);
    expect(String(fetching.mock.calls[0]?.[0])).toMatch(/\/api\/runs\/latest$/);
  });

  it("renders the run's units in sequence order", async () => {
    apiAnswers(200, run);

    const rows = rowsOf(await renderPage());

    expect(rows).toHaveLength(3);
    expect(rows).toEqual([
      expect.stringMatching(/\b1\b.*\bdone\b/),
      expect.stringMatching(/\b2\b.*\bfailed\b/),
      expect.stringMatching(/\b3\b.*\bpending\b/),
    ]);
  });

  it("shows an empty state when no run exists", async () => {
    apiAnswers(404, { error: "no run has been created yet" });

    const page = await renderPage();

    expect(page.textContent).toMatch(/no run yet/i);
    expect(rowsOf(page)).toEqual([]);
  });
});
