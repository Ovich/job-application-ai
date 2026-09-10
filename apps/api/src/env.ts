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
 */
const localRuntime = z.object({
  APP_RUNTIME: z.literal("local"),
  ...shared,
  DATABASE_HOST: z.string().min(1).default("localhost"),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().min(1).default("jobapp"),
  DATABASE_USER: z.string().min(1).default("jobapp"),
  DATABASE_PASSWORD: z.string().min(1).default("local_dev_only"),
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
 */
const cloudRuntime = z.object({
  APP_RUNTIME: z.literal("cloud"),
  ...shared,
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
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
} = process.env;

// The discriminator defaults to the local runtime so a clone runs with nothing set; the
// deployed function is given `cloud` explicitly by the template.
const runtime = APP_RUNTIME ?? "local";

/** The parsed, frozen configuration. The only export, and the only reader of the environment. */
export const env = Object.freeze(
  configuration.parse({
    APP_RUNTIME: runtime,
    PORT,
    // Where the connection comes from, and the only line the two runtimes disagree on.
    ...(runtime === "cloud"
      ? partsOf(DATABASE_URL)
      : { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD }),
  }),
);
