import { Hono } from "hono";
import { readHealth, streamHealth } from "../handlers/health";

/**
 * The health routes: paths and handlers, nothing else (rule 10). What each one proves
 * is written where it is done, in `apps/api/src/handlers/health.ts`.
 */
export const health = new Hono().get("/", ...readHealth).get("/stream", ...streamHealth);
