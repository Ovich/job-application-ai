import { Hono } from "hono";
import { addDocument, listDocuments, removeDocument } from "../handlers/documents";
import { answerQuestion, readProfile } from "../handlers/profile";
import { readDocuments } from "../handlers/reading";

/**
 * The intake routes: paths and handlers, nothing else. What each one proves is written
 * where it is done, in `apps/api/src/handlers/documents.ts`, `reading.ts` and `profile.ts`.
 *
 * The documents, the reading run, the profile that run produces, and the answer to one of
 * its questions. The route that wrote a rule on an item nobody asked about had no caller
 * and is gone (D14).
 *
 * This is not an interface change and `ID118`'s row would say so if it were: the route
 * object is the same one SL2 exported, and every path here is on the register's own list.
 *
 * **Skip is not a route.** It is what `POST /questions/:id/answer` does when the body
 * says `skip`, because skipping is one of the things a person does to an open question
 * and `ID118` names six routes, not seven.
 */
export const intake = new Hono()
  .post("/documents", ...addDocument)
  .get("/documents", ...listDocuments)
  .delete("/documents/:id", ...removeDocument)
  .post("/read", ...readDocuments)
  .get("/profile", ...readProfile)
  .post("/questions/:id/answer", ...answerQuestion);
