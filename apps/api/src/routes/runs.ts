import { Hono } from "hono";
import { createRun, readLatestRun } from "../handlers/runs";

/**
 * The run routes: paths and handlers, nothing else. What a route does, including
 * validating its body, belongs to the handler it names (rule 10).
 */
export const runs = new Hono().get("/latest", ...readLatestRun).post("/", ...createRun);
