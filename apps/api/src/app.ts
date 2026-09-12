import { Hono } from "hono";
import { mock } from "./lib/ai/mock";
import { auth } from "./lib/auth";
import { health } from "./routes/health";

/** The product's own API, everything under `/api`. */
const api = new Hono()
  .route("/health", health)
  // The authentication library's routes, every method, the raw request handed over
  // and its response returned as is. This is the one mount and there is no route of
  // ours beside it: sign-in, callback, session and sign-out are the library's own
  // (board D2, ID59), under the `/api/auth` base path it defaults to.
  .all("/auth/*", (c) => auth.handler(c.req.raw));

/**
 * The Hono application. It imports nothing from AWS, so the same object is what the
 * Node server serves in development, what the Lambda entry point wraps in the cloud,
 * and what every test calls through `app.request` (ID4).
 */
export const app = new Hono()
  .route("/api", api)
  // The AI double, a sibling of `/api` and deliberately not a path under it (ID110).
  // The deployed distribution has a behaviour for `/api/*` that disables caching and
  // forwards headers; a double mounted under it would inherit that behaviour, and would
  // be reachable by any client of the product's own API. The base URL a caller is given
  // is therefore `<origin>/mock/v1`, which is what the client appends
  // `/chat/completions` to.
  .route("/mock/v1", mock)
  // Hono answers an unmatched path with plain text. Everything else this API says is
  // JSON, and a client that parses every answer the same way should not meet a syntax
  // error at the one moment it is already lost. The distribution passes this through
  // unchanged: only a 403 is mapped to the page (see infra/App-dev.yaml).
  .notFound((c) => c.json({ error: "no such route" }, 404));

/** The type the web app's RPC client is built from: types flow, nothing is redeclared. */
export type AppType = typeof app;
