import { Hono } from "hono";
import { addDocument, listDocuments, removeDocument } from "../handlers/documents";
import { readProfile } from "../handlers/profile";
import { readDocuments } from "../handlers/reading";
import type { Assistant, ConversationsAgent } from "../lib/assistant";

/**
 * The intake routes: paths and handlers, nothing else. What each one proves is written
 * where it is done, in `apps/api/src/handlers/documents.ts`, `reading.ts` and `profile.ts`.
 *
 * The documents, the reading run, and the profile that run produces. The route that wrote a
 * rule on an item nobody asked about had no caller and is gone (D14), and so is the one that
 * answered a question: an answer or a skip is the profile assistant's action, run by
 * `POST /api/conversations/profile/actions/:action` (D9, S7.2).
 *
 * Built from the agent and the profile's definition the composition root holds (rule 7,
 * D34), as the conversations routes are: the reading notifies the profile conversation
 * through that agent, and this file builds none.
 */
export const intakeOf = (agent: ConversationsAgent, profile: Assistant) =>
  new Hono()
    .post("/documents", ...addDocument)
    .get("/documents", ...listDocuments)
    .delete("/documents/:id", ...removeDocument)
    .post("/read", ...readDocuments(agent, profile))
    .get("/profile", ...readProfile);
