import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./env";

/**
 * The development entry point: a Node server in front of the same application the
 * cloud serves. Wiring only (ID7); the cloud's entry point is S2.5's `lambda.ts`.
 */
serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});
