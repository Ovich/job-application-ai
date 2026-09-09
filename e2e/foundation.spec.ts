import { createHash } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Whether a push put this on the internet. The subject is the deployed development
 * address and nothing else: the page served from the cloud, the function behind the
 * same name, and a real database under both. Every one of those exists locally
 * already, so nothing here would be worth asserting against `localhost` — this spec
 * is the one that fails until a pipeline has run.
 *
 * It writes before it reads, on purpose. A run is created through the deployed API and
 * the page is then asked to show that same run, so a page that merely loaded, an empty
 * state, or a run whose units never made it out of the database all fail here. The
 * count and the sequence numbers are checked because "some units are on the screen" is
 * exactly the assertion that would pass against a half-working read.
 *
 * The address is the project's, in `playwright.config.ts`, under the `deployed`
 * project; run it with `pnpm test:e2e:deployed`.
 *
 * No workflow runs this. It is the operator check of `D3`, run by a person against a
 * deployed address when a slot is being validated, and it is deliberately not a step of
 * the deploy pipeline: exercising the product on every merge writes runs into the domain
 * tables forever, which on prod means writing product data as a side effect of shipping.
 * Amended from `D9` on 2026-09-09. Running it does write a run to whatever environment
 * it is pointed at, so point it at dev.
 */

/** How many units the run under test has: enough that a wrong count is a wrong count. */
const units = 3;

/**
 * What this run is called. It is the one thing the page prints back that identifies
 * the run this spec created, so it names the check rather than the demonstration.
 */
const kind = "deploy-check";

/**
 * A run created through the deployed API, with the header a signed origin requires.
 *
 * Origin access control signs the request that reaches the function and the signature
 * covers a SHA-256 of the body, which CloudFront does not compute: the sender states
 * it in `x-amz-content-sha256`. The browser client does this for every write
 * (`apps/web/src/app/lib/api.ts`), and a request made from the test process rather
 * than from the page has to do the same or the origin rejects it.
 */
const startRun = async (request: APIRequestContext, howMany: number) => {
  const body = JSON.stringify({ kind, units: howMany });
  const created = await request.post("/api/runs", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(id).toBeTruthy();
  return id;
};

test("the deployed page shows a run and its units", async ({ page, request }) => {
  await startRun(request, units);

  await page.goto("/");

  // The run this spec just created is the latest one, and the summary is where the
  // page says which run it is reading. Waiting on it is also what waits for the read
  // to have happened at all.
  await expect(page.locator("run-summary")).toContainText(kind);

  // The empty state and the units are mutually exclusive answers, and a page that
  // rendered the wrong one still renders something, so both are stated.
  await expect(page.locator("no-run-yet")).toHaveCount(0);

  const rows = page.locator("unit-row");
  await expect(rows).toHaveCount(units);

  // Numbered from one, in order: the units belong to a run, and a run in the wrong
  // order is not the run that was created.
  const sequences = await Promise.all(
    Array.from({ length: units }, (_unit, index) =>
      rows.nth(index).locator("span").first().innerText(),
    ),
  );
  expect(sequences.map((text) => text.trim())).toEqual(
    Array.from({ length: units }, (_unit, index) => String(index + 1)),
  );
});
