import { describe, expect, it } from "vitest";
import { app } from "../src/app";

/**
 * What the application answers when no route matches.
 *
 * Hono's default is `text/plain`, which was invisible while every `/api` path belonged
 * to a handler that wrote its own JSON error. With the runs routes gone, an unknown
 * `/api` path reached that default and the deployed check caught it: a client that
 * parses every API answer as JSON gets a syntax error instead of a message it can read.
 */
describe("an unknown path", () => {
  it("is answered as JSON, like every other API answer", async () => {
    const answer = await app.request("/api/nope");

    expect(answer.status).toBe(404);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(await answer.json()).toEqual({ error: "no such route" });
  });
});
