import { Hono } from "hono";
import { health } from "./routes/health";

/**
 * The Hono application. It imports nothing from AWS, so the same object is what the
 * Node server serves in development, what the Lambda entry point wraps in the cloud,
 * and what every test calls through `app.request` (ID4).
 */
export const app = new Hono().basePath("/api").route("/health", health);

/** The type the web app's RPC client is built from: types flow, nothing is redeclared. */
export type AppType = typeof app;
