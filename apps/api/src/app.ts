import { Hono } from "hono";
import { profileAssistant } from "./assistants/profile";
import { ConversationAgent } from "./lib/agent";
import { answeredInProcessBy, chatModel } from "./lib/ai";
import { auth } from "./lib/auth";
import { append, entries, type Transaction } from "./lib/conversation";
import { db } from "./lib/db";
import { conversationsOf } from "./routes/conversations";
import { health } from "./routes/health";
import { intake } from "./routes/intake";
import { mock } from "./routes/mock";

/**
 * The conversation agent, built here and nowhere else (`AGENTS.md` rule 7, `ID298`).
 *
 * `lib/agent` knows no application: this is the one file that decides which model it asks,
 * which store it reads and writes a conversation through, which transaction a step commits
 * in, and what the header naming a step's case is called on this product's wire. The
 * header is the mock's own (`X-Jobapp-Case`), so what travels is what travelled before
 * (D19); the module's own default names no product.
 */
const agent = new ConversationAgent({
  model: chatModel(),
  store: { entries, append },
  transaction: <T>(run: (tx: Transaction) => Promise<T>) => db.transaction(run),
  caseHeader: "X-Jobapp-Case",
});

/** The product's own API, everything under `/api`. */
const api = new Hono()
  .route("/health", health)
  // The intake: what a person hands over, and the reading of it (ID118).
  .route("/intake", intake)
  // A person's conversations with the assistants, one registry of definitions held here
  // and nowhere else (ID186): an assistant added later is a value in this list.
  .route("/conversations", conversationsOf(agent, [profileAssistant]))
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
  // be reachable by any client of the product's own API. The base URL a laptop is given
  // is therefore `<origin>/mock/v1`, which is what the client appends
  // `/chat/completions` to.
  //
  // **It is unreachable in production, and by configuration rather than by a branch**
  // (ID150, the person, 2026-09-12: *"I just dont like environement conditions in the
  // code"*). These handlers ship in the deployed bundle and no path of the distribution
  // reaches them; the deployed function is handed an in-process dispatch as a value at
  // its composition root, so it answers itself with no network hop (ID130, SL6). No
  // module here asks which environment it is in, and this line is the same line in both.
  .route("/mock/v1", mock)
  // Hono answers an unmatched path with plain text. Everything else this API says is
  // JSON, and a client that parses every answer the same way should not meet a syntax
  // error at the one moment it is already lost. The distribution passes this through
  // unchanged: only a 403 is mapped to the page (see infra/App-dev.yaml).
  .notFound((c) => c.json({ error: "no such route" }, 404));

// The composition root's one act beyond assembling the routes: `lib/ai` is handed the
// application that answers its own address, so a call to a base URL that is this app's
// is answered here, in process, with no network hop (ID130, ID150, F1). It is handed
// over rather than imported there, because `lib/ai` is reached by the very steps this
// file is assembled from. Nothing about which environment this is enters into it: the
// boundary compares the address it was configured with against this app's own, and a
// base URL naming anywhere else is dialled.
answeredInProcessBy(async (request) => app.fetch(request));

/** The type the web app's RPC client is built from: types flow, nothing is redeclared. */
export type AppType = typeof app;
