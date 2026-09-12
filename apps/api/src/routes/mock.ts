import { Hono } from "hono";
import { answerChatCompletions, answerMessages } from "../lib/mock";

/**
 * The double's routes: paths and handlers, nothing else — the shape `routes/intake.ts`
 * and `routes/health.ts` already have (`ID146`, `S7.1` criterion 4; the person's own
 * comment: *"We dont need the mock to expose the routes, just expose them as our typical
 * handlers"*).
 *
 * The two paths are the two wire protocols this product may be spoken to in, and where
 * the whole thing is mounted is `app.ts`'s decision, not this module's.
 */
export const mock = new Hono()
  .post("/chat/completions", ...answerChatCompletions)
  .post("/messages", ...answerMessages);
