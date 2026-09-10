import { Hono } from "hono";
import { health } from "./routes/health";

/**
 * The Hono application. It imports nothing from AWS, so the same object is what the
 * Node server serves in development, what the Lambda entry point wraps in the cloud,
 * and what every test calls through `app.request` (ID4).
 */
export const app = new Hono()
  .basePath("/api")
  .route("/health", health)
  // Hono answers an unmatched path with plain text. Everything else this API says is
  // JSON, and a client that parses every answer the same way should not meet a syntax
  // error at the one moment it is already lost. The distribution passes this through
  // unchanged: only a 403 is mapped to the page (see infra/App-dev.yaml).
  .notFound((c) => c.json({ error: "no such route" }, 404));

/** The type the web app's RPC client is built from: types flow, nothing is redeclared. */
export type AppType = typeof app;
