import { Hono } from "hono";
import { addDocument, listDocuments, readDocuments, removeDocument } from "../handlers/intake";

/**
 * The intake routes: paths and handlers, nothing else. What each one proves is written
 * where it is done, in `apps/api/src/handlers/intake.ts`.
 *
 * `ID118` lists six routes for the intake across SL2 to SL5; these are the first three
 * of them, plus the reading run. `GET /profile`, `POST /questions/:id/answer` and
 * `POST /items/:id/rule` belong to the slices that have something to answer with.
 */
export const intake = new Hono()
  .post("/documents", ...addDocument)
  .get("/documents", ...listDocuments)
  .delete("/documents/:id", ...removeDocument)
  .post("/read", ...readDocuments);
