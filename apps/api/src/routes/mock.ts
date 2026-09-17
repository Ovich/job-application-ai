import { Hono } from "hono";
import { env } from "../env";
import { ModelMock } from "../lib/mock";
import { mockAnswers } from "../mock-answers";

/**
 * The binding: the one file that knows a mock exists (`AGENTS.md` rule 5, `ID295`).
 *
 * The instance is exported for the suite's own support, which adds a test's answers to it
 * and reads what it was asked (`tests/support/ai.ts`); the application mounts `mock` alone.
 */
export const model = new ModelMock(mockAnswers, {
  caseHeader: "X-Jobapp-Case",
  paceHeader: "X-Jobapp-Mock-Pace",
  pace: env.AI_MOCK_PACE,
});

/**
 * The two paths are the two wire protocols this product may be spoken to in, as every
 * route file holds its own (`ID146`); where the whole is mounted is `app.ts`'s decision.
 */
export const mock = new Hono()
  .post("/chat/completions", (c) => model.chatCompletions(c.req.raw))
  .post("/messages", (c) => model.messages(c.req.raw));
