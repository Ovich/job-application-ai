import { createHash } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * What every browser check needs before it can observe anything: a run to observe.
 *
 * It lives here because the same call has to satisfy two different front doors. Against
 * the dev server the header below is surplus and harmless; against the development
 * address it is the difference between a run and a 403, and a spec that got that wrong
 * would fail for a reason that has nothing to do with what it measures.
 *
 * Origin access control signs the request that reaches the function, and the signature
 * covers a SHA-256 of the body, which CloudFront does not compute: the sender states it
 * in `x-amz-content-sha256`. The browser client does this for every write
 * (`apps/web/src/app/lib/api.ts`), and a request made from the test process rather than
 * from the page has to do the same.
 */
export const startRun = async (
  request: APIRequestContext,
  kind: string,
  units: number,
): Promise<string> => {
  const body = JSON.stringify({ kind, units });
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
