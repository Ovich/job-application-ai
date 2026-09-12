import { Hono } from "hono";
import {
  addDocument,
  listDocuments,
  readDocuments,
  readProfile,
  removeDocument,
} from "../handlers/intake";

/**
 * The intake routes: paths and handlers, nothing else. What each one proves is written
 * where it is done, in `apps/api/src/handlers/intake.ts`.
 *
 * `ID118` lists six routes for the intake across SL2 to SL5; these are the first three
 * of them, the reading run, and the profile that run produces.
 * `POST /questions/:id/answer` and `POST /items/:id/rule` belong to the slices that
 * have something to answer with.
 *
 * This is not an interface change and `ID118`'s row would say so if it were: the route
 * object is the same one SL2 exported, and `GET /profile` is on the register's own list.
 */
export const intake = new Hono()
  .post("/documents", ...addDocument)
  .get("/documents", ...listDocuments)
  .delete("/documents/:id", ...removeDocument)
  .post("/read", ...readDocuments)
  .get("/profile", ...readProfile);
