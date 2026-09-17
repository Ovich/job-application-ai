import { Hono } from "hono";
import { openConversation, postMessage, runAction } from "../handlers/conversations";
import type { Assistant, ConversationsAgent } from "../lib/assistant";

/**
 * The conversations routes: paths and handlers, nothing else (`ID163`). What each one
 * proves is written where it is done, in `apps/api/src/handlers/conversations.ts`.
 *
 * Built from the agent and the registry of assistant definitions the composition root
 * holds (`ID186`, `AGENTS.md` rule 7), so `app.ts` decides which model the agent asks and
 * which assistants exist, and this file names neither.
 */
export const conversationsOf = (agent: ConversationsAgent, definitions: Assistant[]) =>
  new Hono()
    .get("/:assistant", ...openConversation(definitions))
    .post("/:assistant/messages", ...postMessage(agent, definitions))
    .post("/:assistant/actions/:action", ...runAction(agent, definitions));
