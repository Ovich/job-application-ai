import { z } from "zod";

/**
 * The API's configuration. It is read from the process environment once, at module
 * load, and validated by one schema; nothing else in the API reads `process.env`, and
 * a value that is missing or malformed throws here, so a cold start fails rather than
 * a request.
 *
 * The shape is a discriminated union on `APP_RUNTIME` rather than one flat object of
 * optional values, so a runtime cannot be half-configured: the local branch's
 * connection is five defaults nobody has to set, and the cloud branch's is five values
 * that must all be there, taken from the one connection string Secrets Manager holds.
 * Neither branch can reach the other's values, and a site that assumed one fails the
 * typecheck rather than fails at runtime.
 */

/** Settings both runtimes share, spread into each branch so the union stays flat. */
const shared = {
  PORT: z.coerce.number().int().positive().default(3000),
};

/**
 * The developer's Postgres container. The defaults are the throwaway credentials
 * committed in `docker-compose.yml`, the precedent `packages/db/drizzle.config.ts`
 * already sets, so a fresh clone answers on localhost with one command and no file to
 * write first. They are not secrets and never reach the cloud branch, whose
 * credentials come from Secrets Manager through the template.
 *
 * The provider clients are the one thing a fresh clone must be given (ID60): a client
 * secret has no sensible throwaway value the way the database password does, so there
 * is no default, and a missing one fails the start with the field named. They come out
 * of `apps/api/.env`, which the repository ignores and `.env.example` names the keys
 * of (ID68). Three providers at launch (D4), so three pairs: Google, the Microsoft
 * Entra app, the LinkedIn app. `APP_URL` is where the browser reaches the app, and so
 * the origin each provider sends it back to: the dev server, which forwards `/api` to
 * this process. Registered at each as `<APP_URL>/api/auth/callback/<provider>`; a
 * port's difference between the two is a `redirect_uri_mismatch`.
 *
 * `BETTER_AUTH_SECRET` is what the authentication library signs its session cookies
 * with (ID71). It is read here, and handed to the library as configuration, because
 * this module is the only reader of the process environment: absent the option, the
 * library reads the variable itself, which would put a second reader behind that
 * boundary and silently — the value right and the boundary wrong. Locally it does have
 * a sensible throwaway value, unlike a client secret, and `.env.example` fills it in
 * (ID103): the local database holds no real person, and the end-to-end fixture has to
 * sign with the same value the dev server verifies with.
 */
const localRuntime = z.object({
  APP_RUNTIME: z.literal("local"),
  ...shared,
  DATABASE_HOST: z.string().min(1).default("localhost"),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().min(1).default("jobapp"),
  DATABASE_USER: z.string().min(1).default("jobapp"),
  DATABASE_PASSWORD: z.string().min(1).default("local_dev_only"),
  APP_URL: z.url().default("http://localhost:4200"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
});

/**
 * The deployed function. Every value is required and none has a default, so that
 * a function whose configuration is half-set fails its cold start
 * with the field named, rather than answering requests against a database on its own
 * loopback interface (ID23).
 *
 * The fields are the local runtime's, and that is the point: `lib/db` builds one
 * options object out of them and has no branch in it (D16). They do not arrive one by
 * one, though. Neon issues a single pooled connection string, Secrets Manager holds it,
 * the template hands it over as `DATABASE_URL`, and `partsOf` below is what turns it
 * back into these five (D19). The password is a password now, where the Aurora cluster
 * had an identity token minted per connection; secrets reach the function through Secrets Manager.
 *
 * The provider clients, the app's address and the library's secret were the exception
 * to "every value is required", and only until slice 5. They were optional because a
 * merge to `main` deploys and Secrets Manager held none of them before S5.2: required
 * then, they would have failed every cold start in between, the health route with it.
 * S5.2 puts them in the template and takes the exception away in the same breath, so
 * the two branches now ask for the same values and a half-configured function fails its
 * cold start naming the field rather than serving a door that leads nowhere (ID60,
 * ID71, ID23).
 */
const cloudRuntime = z.object({
  APP_RUNTIME: z.literal("cloud"),
  ...shared,
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  APP_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
});

/**
 * The connection string, split into the fields above.
 *
 * Split here rather than in `lib/db`, because this is the module that reads the
 * environment and types what it read; what the database module receives is
 * the same five values whichever runtime produced them. A missing port is PostgreSQL's
 * 5432, and the user and the password are percent-decoded, because a URL is where they
 * were escaped and a driver must not be handed them still escaped.
 */
const partsOf = (url: string | undefined): Record<string, string> => {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error(
      "DATABASE_URL is not a connection string. The cloud runtime is given Neon's pooled string from Secrets Manager.",
    );
  }
  return {
    DATABASE_HOST: parsed.hostname,
    DATABASE_PORT: parsed.port === "" ? "5432" : parsed.port,
    DATABASE_NAME: parsed.pathname.replace(/^\//, ""),
    DATABASE_USER: decodeURIComponent(parsed.username),
    DATABASE_PASSWORD: decodeURIComponent(parsed.password),
  };
};

const configuration = z.discriminatedUnion("APP_RUNTIME", [localRuntime, cloudRuntime]);

// Destructured rather than indexed: the strictest TypeScript base requires bracket
// notation on the process environment and Biome's literal-keys rule forbids it, and
// this form is the one both accept.
const {
  APP_RUNTIME,
  PORT,
  DATABASE_URL,
  DATABASE_HOST,
  DATABASE_PORT,
  DATABASE_NAME,
  DATABASE_USER,
  DATABASE_PASSWORD,
  APP_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  BETTER_AUTH_SECRET,
} = process.env;

// The discriminator defaults to the local runtime so a clone runs with nothing set; the
// deployed function is given `cloud` explicitly by the template.
const runtime = APP_RUNTIME ?? "local";

/** The parsed, frozen configuration. The only export, and the only reader of the environment. */
export const env = Object.freeze(
  configuration.parse({
    APP_RUNTIME: runtime,
    PORT,
    APP_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET,
    LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET,
    BETTER_AUTH_SECRET,
    // Where the connection comes from, and the only line the two runtimes disagree on.
    ...(runtime === "cloud"
      ? partsOf(DATABASE_URL)
      : { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD }),
  }),
);
