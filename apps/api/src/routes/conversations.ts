import { Hono } from "hono";
import { openConversation } from "../handlers/conversations";
import type { AssistantDefinition } from "../lib/agent";

/**
 * The conversations routes: paths and handlers, nothing else (`ID163`). What each one
 * proves is written where it is done, in `apps/api/src/handlers/conversations.ts`.
 *
 * Built from the registry of assistant definitions the composition root holds
 * (`ID186`), so `app.ts` decides which assistants exist and this file names none. The
 * POST that adds a message arrives with `SL3`.
 */
export const conversationsOf = (definitions: AssistantDefinition[]) =>
  new Hono().get("/:assistant", ...openConversation(definitions));
