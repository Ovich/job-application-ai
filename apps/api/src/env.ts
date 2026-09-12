import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * The API's configuration. It is read from the process environment once, at module
 * load, and validated by one schema; nothing else in the API reads `process.env`, and
 * a value that is missing or malformed throws here, so a cold start fails rather than
 * a request.
 *
 * **One flat object, and one schema** (`S7.2`, the person's own comment: *"Can we avoid
 * the discriminator function by using full host path env variables?"*). Where the shape
 * used to be a discriminated union on `APP_RUNTIME` over two branches that differed in
 * one line of composition, each thing a runtime needs is now named by one URL that
 * carries everything about it: `DATABASE_URL` is the connection, whole, and the driver
 * reads its host, its port, its credentials and its TLS mode out of it; `STORAGE_URL`
 * is where bytes go, and its scheme is which implementation is built. Nothing splits a
 * URL back into parts here, nothing branches on a runtime below here, and a site that
 * wants one of these values reads one field.
 *
 * **What the union bought, and where that guarantee now lives** (`S7.2`, criterion 11).
 * The union's value was never its shape: it was that the cloud branch had no defaults,
 * so a function whose configuration was half set failed its cold start naming the field
 * instead of answering requests against a database on its own loopback. A flat schema
 * with local defaults gives that up, silently, and the replacement is deliberate rather
 * than promised: `infra/tests/invariants.test.ts` now asserts that the template sets
 * every value whose local default would be wrong in the cloud. The template is where
 * the deployed configuration actually lives, and a test on the template fails in CI
 * rather than at a cold start nobody is watching.
 */

/** The port a laptop serves on, named because the AI's local default is built from it. */
const defaultPort = 3000;

/**
 * The developer's Postgres container, as one connection string: the throwaway
 * credentials committed in `docker-compose.yml`, the precedent
 * `packages/db/drizzle.config.ts` already sets, so a fresh clone answers on localhost
 * with one command and no file to write first. They are not secrets. The deployed
 * function is handed Neon's pooled string from Secrets Manager through the template,
 * in this same variable, and `lib/db` cannot tell which of the two it received (`D16`,
 * `D19`).
 *
 * No `sslmode` here and `sslmode=require` in Neon's own string: the TLS decision the
 * discriminator used to carry is a parameter of the connection, which is where it
 * belongs, and the driver reads it.
 */
const defaultDatabaseUrl = "postgresql://jobapp:local_dev_only@localhost:5432/jobapp";

/**
 * Where uploaded bytes go (ID115, ID128), as one URL whose scheme is the choice.
 * `file:///…` is the directory a developer runs, `s3://<bucket>` is what the deployed
 * environment runs, and both are production: the directory is what `pnpm dev` writes
 * into and reads back, not a fake. `lib/storage` takes the URL and builds the
 * implementation its scheme names; it reads no environment of its own.
 *
 * The local default resolves `.objects` against the process's own directory, which puts
 * it under the repository where `.gitignore` keeps it — the same place the relative
 * path it replaces resolved to, written as an absolute URL because that is what a
 * `file:` URL is.
 */
const defaultStorageUrl = pathToFileURL(resolve(".objects")).href;

/**
 * How big an upload may be (ID134). It is forced rather than chosen: a function URL
 * accepts a request of about 6 MB, and a document travels inside a multipart body with
 * its own overhead, so the document itself must fit under that. The person's own
 * largest CV is 4.5 MB, which makes it the file the suite uploads.
 *
 * It is configuration rather than a constant so an environment can lower it without a
 * code change, and it is a number of bytes because that is what a request's content
 * length is measured in and what the refusal has to name.
 */
const uploadLimitBytes = 5 * 1024 * 1024;

/**
 * The one schema. Every value either has a default a laptop can run on, or has none and
 * fails the load with its own name — and the values that have one are exactly the
 * values the template sets explicitly, which is the invariant that replaced the union.
 *
 * The provider clients are the one thing a fresh clone must be given (ID60): a client
 * secret has no sensible throwaway value the way the database password does, so there
 * is no default, and a missing one fails the start with the field named. They come out
 * of `apps/api/.env`, which the repository ignores and `.env.example` names the keys of
 * (ID68). Three providers at launch (D4), so three pairs: Google, the Microsoft Entra
 * app, the LinkedIn app. `APP_URL` is where the browser reaches the app, and so the
 * origin each provider sends it back to; registered at each as
 * `<APP_URL>/api/auth/callback/<provider>`, and a port's difference between the two is
 * a `redirect_uri_mismatch`.
 *
 * `BETTER_AUTH_SECRET` is what the authentication library signs its session cookies
 * with (ID71). It is read here, and handed to the library as configuration, because
 * this module is the only reader of the process environment: absent the option, the
 * library reads the variable itself, which would put a second reader behind that
 * boundary and silently — the value right and the boundary wrong. Locally it does have
 * a sensible throwaway value, unlike a client secret, and `.env.example` fills it in
 * (ID103).
 *
 * The AI boundary's four (ID114, ID127) need no key and no account: every environment
 * of this slot calls the mock mounted in this same application (D14), so `AI_BASE_URL`
 * defaults to this process's own address, computed below. It is the only switch there
 * is — point it at OpenAI, at Azure, at a self-hosted vLLM or at Anthropic's
 * OpenAI-compatible endpoint and the integration is the same one, because the product
 * speaks one wire protocol and branches on no provider (D9). It ends at the
 * `/v1`-equivalent, because the client appends `/chat/completions` itself.
 * `AI_MOCK_PACE` carries the four pacing settings spelled the way the per-request
 * header spells them, so the default and the exception read alike (D13).
 */
const configuration = z.object({
  PORT: z.coerce.number().int().positive().default(defaultPort),

  DATABASE_URL: z.url().default(defaultDatabaseUrl),

  STORAGE_URL: z
    .url()
    .refine(
      (url) => new URL(url).protocol === "file:" || new URL(url).protocol === "s3:",
      "STORAGE_URL names which implementation stores bytes by its scheme: file:// or s3://",
    )
    .default(defaultStorageUrl),

  UPLOAD_LIMIT_BYTES: z.coerce.number().int().positive().default(uploadLimitBytes),

  APP_URL: z.url().default("http://localhost:4200"),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),

  AI_BASE_URL: z.url(),
  AI_API_KEY: z.string().min(1).default("local_dev_only_the_mock_ignores_it"),
  AI_MODEL: z.string().min(1).default("mock-model"),
  AI_MOCK_PACE: z.string().min(1).default("tps=40;ttft=400;chunk=3;jitter=0.15"),
});

// Destructured rather than indexed: the strictest TypeScript base requires bracket
// notation on the process environment and Biome's literal-keys rule forbids it, and
// this form is the one both accept.
const {
  APP_RUNTIME,
  PORT,
  DATABASE_URL,
  STORAGE_URL,
  UPLOAD_LIMIT_BYTES,
  APP_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  BETTER_AUTH_SECRET,
  AI_BASE_URL,
  AI_API_KEY,
  AI_MODEL,
  AI_MOCK_PACE,
} = process.env;

/**
 * Where this application's own mock answers, which is what the AI's base URL defaults
 * to. It is computed rather than written into the schema because it is the address of
 * this very process: locally the port the server binds, in the cloud the name the
 * browser reaches the app by. `/mock/v1` is a sibling of `/api`, so nothing about the
 * distribution's `/api/*` behaviour applies to it (ID110).
 *
 * `APP_RUNTIME` survives only here, and it is no longer part of the configuration this
 * module exports: nothing outside this file reads it, no schema branches on it, and the
 * one line that used to — `lib/db`'s `ssl` — reads the connection string's own
 * `sslmode` instead. What is left is which of two addresses this process answers at,
 * and where the mock is mounted is `S7.1`'s to settle; until it does, this is the line
 * it is settled on, unchanged.
 */
const ownMock = `${
  APP_RUNTIME === "cloud"
    ? (APP_URL ?? "").replace(/\/$/, "")
    : `http://localhost:${PORT === undefined || PORT === "" ? defaultPort : PORT}`
}/mock/v1`;

/** The parsed, frozen configuration. The only export, and the only reader of the environment. */
export const env = Object.freeze(
  configuration.parse({
    PORT,
    DATABASE_URL,
    STORAGE_URL,
    UPLOAD_LIMIT_BYTES,
    APP_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET,
    LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET,
    BETTER_AUTH_SECRET,
    AI_BASE_URL: AI_BASE_URL ?? ownMock,
    AI_API_KEY,
    AI_MODEL,
    AI_MOCK_PACE,
  }),
);
