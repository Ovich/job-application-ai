import { expect, test } from "@playwright/test";
import { startRun } from "./support/api";

/**
 * Whether a push put this on the internet (US1, US3). The subject is the deployed
 * development address and nothing else: the function behind the name, and a real
 * database under it. Every one of those exists locally already, so nothing here would
 * be worth asserting against `localhost`; this spec is the one that fails until a
 * pipeline has run.
 *
 * It writes before it reads, on purpose. A run is created through the deployed API and
 * the API is then asked for the latest run, so a function that merely answers, an empty
 * database, or a run whose units never made it into the database all fail here. The
 * count and the sequence numbers are checked because "some units came back" is exactly
 * the assertion that would pass against a half-working read.
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
 * What this run is called. It is the one thing the API prints back that identifies the
 * run this spec created, so it names the check rather than the demonstration.
 */
const kind = "deploy-check";

test("the deployed API creates a run and reads it back as the latest", async ({ request }) => {
  const id = await startRun(request, kind, units);

  // The run this spec just created is the latest one, and its id is what says the read
  // found this run and not one another spec left behind.
  const latest = await request.get("/api/runs/latest");
  expect(latest.status()).toBe(200);
  const run = (await latest.json()) as {
    id: string;
    kind: string;
    units: { seq: number; status: string }[];
  };
  expect(run.id).toBe(id);
  expect(run.kind).toBe(kind);

  // Numbered from one, in order, and untouched: the units belong to a run nobody has
  // streamed yet, and a run in the wrong order is not the run that was created.
  expect(run.units.map(({ seq }) => seq)).toEqual(
    Array.from({ length: units }, (_unit, index) => index + 1),
  );
  expect(run.units.map(({ status }) => status)).toEqual(Array(units).fill("pending"));
});
