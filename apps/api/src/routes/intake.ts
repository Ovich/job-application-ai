import { Hono } from "hono";
import {
  addDocument,
  answerQuestion,
  listDocuments,
  readDocuments,
  readProfile,
  removeDocument,
  writeItemRule,
} from "../handlers/intake";

/**
 * The intake routes: paths and handlers, nothing else. What each one proves is written
 * where it is done, in `apps/api/src/handlers/intake.ts`.
 *
 * `ID118` lists six routes for the intake across SL2 to SL5, and with SL4 all six are
 * mounted: the documents, the reading run, the profile that run produces, the answer to
 * one of its questions, and the rule the person writes on an item nobody asked about.
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
  .post("/questions/:id/answer", ...answerQuestion)
  .post("/items/:id/rule", ...writeItemRule);
