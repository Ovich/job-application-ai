import { expect, test } from "@playwright/test";

/**
 * Whether a merge put this on the internet, and whether a real database is behind it
 * (US1, US3). The subject is the deployed development address and nothing else: every
 * part of this exists on a laptop already, so nothing here would be worth asserting
 * against `localhost`. This spec is the one that fails until a pipeline has run.
 *
 * It is also the whole of what the deploy job checks after it has moved the schema
 * (D20): the health route is the proof, and unlike the run skeleton it replaced, asking
 * for it writes nothing — which is what makes it safe as a step of every release rather
 * than a thing a person runs once.
 *
 * The address is the project's, in `playwright.config.ts`, under the `deployed`
 * project; run it with `pnpm test:e2e:deployed`.
 */

test("the deployed API answers the health route with the database's own version", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  const health = (await response.json()) as { status: string; database: string };
  expect(health.status).toBe("ok");
  // The engine's own answer to `select version()`. A function that answered without
  // reaching the database has nothing to put here, so this is the assertion that the
  // database is up and reachable from inside the function.
  expect(health.database).toContain("PostgreSQL");
});

/**
 * The distribution's two behaviours in one place, because they are one decision: the
 * page is a single-page application, so an address the app owns must come back as the
 * page, and an address the API owns must come back as the API's own answer. A
 * distribution that sent `/api/*` to the bucket would answer a missing route with the
 * page and status 200, and the failure would look like a routing bug in the browser.
 */
test("the API's 404 is the API's, and a deep link is still the page", async ({ request }) => {
  const missing = await request.get("/api/nothing-is-here");

  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");

  const deepLink = await request.get("/some/deep/link");

  expect(deepLink.status()).toBe(200);
  expect(deepLink.headers()["content-type"]).toContain("text/html");
});
