import { z } from "zod";

/**
 * The API's configuration. It is read from the process environment once, at module
 * load, and validated by one schema; nothing else in the API reads `process.env`, and
 * a value that is missing or malformed throws here, so a cold start fails rather than
 * a request (rule 12).
 *
 * The shape is a discriminated union on `APP_RUNTIME` rather than one flat object of
 * optional values, so a runtime cannot be half-configured: the local branch carries a
 * password, and the cloud branch S2.5 adds carries a region and mints an identity
 * token per connection instead. Neither branch can reach the other's values, and
 * adding the second option makes every site that assumed the first fail the typecheck
 * rather than fail at runtime.
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
 * credentials come from Secrets Manager through CDK.
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
 * The deployed function. Every value is required and none has a default, which is what
 * rule 12 asks for: a function whose configuration is half-set fails its cold start
 * with the field named, rather than answering requests against a database on its own
 * loopback interface (ID23).
 *
 * There is no password here, and that is the point rather than an omission. The cloud
 * branch authenticates with an identity token minted per connection from the function's
 * own role, so no site that reads `DATABASE_PASSWORD` can compile against this branch.
 * `AWS_REGION` is set by the Lambda runtime itself and is the one value nothing
 * declares.
 */
const cloudRuntime = z.object({
  APP_RUNTIME: z.literal("cloud"),
  ...shared,
  AWS_REGION: z.string().min(1),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive(),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
});

const configuration = z.discriminatedUnion("APP_RUNTIME", [localRuntime, cloudRuntime]);

// Destructured rather than indexed: the strictest TypeScript base requires bracket
// notation on the process environment and Biome's literal-keys rule forbids it, and
// this form is the one both accept.
const {
  APP_RUNTIME,
  AWS_REGION,
  PORT,
  DATABASE_HOST,
  DATABASE_PORT,
  DATABASE_NAME,
  DATABASE_USER,
  DATABASE_PASSWORD,
} = process.env;

/** The parsed, frozen configuration. The only export, and the only reader of the environment. */
export const env = Object.freeze(
  configuration.parse({
    // The discriminator defaults to the local runtime so a clone runs with nothing
    // set; the deployed function is given `cloud` explicitly by CDK.
    APP_RUNTIME: APP_RUNTIME ?? "local",
    AWS_REGION,
    PORT,
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE_NAME,
    DATABASE_USER,
    DATABASE_PASSWORD,
  }),
);
