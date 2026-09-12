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

/** The port a laptop serves on, named because the AI's local default is built from it. */
const defaultPort = 3000;

/** Settings both runtimes share, spread into each branch so the union stays flat. */
const shared = {
  PORT: z.coerce.number().int().positive().default(defaultPort),
};

/**
 * The AI boundary's configuration (ID114, ID127). Four values, and the reason there is
 * no key among the required ones is decision D14: every environment of this slot calls
 * the mock, which is mounted in this same application, so a fresh clone runs the whole
 * intake with nothing set and nobody's registration anywhere.
 *
 * `AI_BASE_URL` is the only switch there is. Point it at OpenAI, at Azure, at a
 * self-hosted vLLM or at Anthropic's OpenAI-compatible endpoint and the integration is
 * the same one: the product speaks one wire protocol and branches on no provider (D9).
 * It ends at the `/v1`-equivalent, because the client appends `/chat/completions`
 * itself. Its default is this process's own mock, which is why it is computed below
 * rather than written here: it follows `PORT` locally and `APP_URL` in the cloud.
 *
 * `AI_API_KEY` has a committed throwaway, as the database password and the library's
 * secret do (ID103): the mock does not read it, and the first real key is a Secrets
 * Manager entry in the slot that switches a provider on (ID127).
 *
 * `AI_MODEL` is a name and nothing more while the mock answers, since the mock does not
 * dispatch on it.
 *
 * `AI_MOCK_PACE` carries the four pacing settings the mock's answers are timed by,
 * spelled the way the per-request header spells them, so the default and the exception
 * read alike (D13). The suite sets every one to zero, and the dev server leaves them.
 */
const aiSettings = {
  AI_BASE_URL: z.url(),
  AI_API_KEY: z.string().min(1).default("local_dev_only_the_mock_ignores_it"),
  AI_MODEL: z.string().min(1).default("mock-model"),
  AI_MOCK_PACE: z.string().min(1).default("tps=40;ttft=400;chunk=3;jitter=0.15"),
};

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
 * Where uploaded bytes go (ID115, ID128). `lib/storage` takes these as arguments and
 * reads no environment of its own, so this is the one place the choice is made.
 *
 * `STORAGE_IMPLEMENTATION` is the switch, and the two values are both production: the
 * directory is what a developer runs and S3 is what the deployed environment runs. Its
 * default is the runtime's own, which is what lets a fresh clone upload a document with
 * nothing set and no bucket anywhere — and what makes a deployed function that was
 * given no value store into a bucket rather than into a container's disk.
 *
 * `STORAGE_DIRECTORY` is relative, resolved against the process's own directory, so it
 * lands under the repository and `.gitignore` keeps it out. `STORAGE_BUCKET` has no
 * default in the cloud: a function pointed at no bucket fails at the first upload
 * instead of at the cold start, and the bucket and the code arrive in the same change
 * (ID116), so there is no window in which requiring it would break a deploy.
 */
const storageSettings = (implementation: "directory" | "s3") => ({
  STORAGE_IMPLEMENTATION: z.enum(["directory", "s3"]).default(implementation),
  STORAGE_DIRECTORY: z.string().min(1).default(".objects"),
  UPLOAD_LIMIT_BYTES: z.coerce.number().int().positive().default(uploadLimitBytes),
});

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
  ...aiSettings,
  ...storageSettings("directory"),
  // No bucket on a laptop, and nothing to set: the empty string is what "there is no
  // bucket here" reads as, and the directory implementation never looks at it.
  STORAGE_BUCKET: z.string().default(""),
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
  // The AI's four are the one exception to "every value is required", and only until
  // SL6, which is the slice that puts them in the template. Every merge deploys, and a
  // value required before the template sets it fails the cold start of a function that
  // makes no AI call at all — the health route with it. This is the same exception the
  // provider clients carried between SL2 and S5.2, written down the same way and with
  // the same end: SL6 supplies them and takes the defaults away in one breath (ID114).
  ...aiSettings,
  ...storageSettings("s3"),
  // The bucket this slice's own template creates (ID116). Required, and the one storage
  // value that is: the resource and the code that looks for it arrive together, so
  // there is no deploy between them that this could fail.
  STORAGE_BUCKET: z.string().min(1),
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
  AI_BASE_URL,
  AI_API_KEY,
  AI_MODEL,
  AI_MOCK_PACE,
  STORAGE_IMPLEMENTATION,
  STORAGE_DIRECTORY,
  STORAGE_BUCKET,
  UPLOAD_LIMIT_BYTES,
} = process.env;

// The discriminator defaults to the local runtime so a clone runs with nothing set; the
// deployed function is given `cloud` explicitly by the template.
const runtime = APP_RUNTIME ?? "local";

/**
 * Where this application's own mock answers, which is what the AI's base URL defaults
 * to. It is computed rather than written into the schema because it is the address of
 * this very process: locally the port the server binds, in the cloud the name the
 * browser reaches the app by. `/mock/v1` is a sibling of `/api`, so nothing about the
 * distribution's `/api/*` behaviour applies to it (ID110).
 */
const ownMock = `${
  runtime === "cloud"
    ? (APP_URL ?? "").replace(/\/$/, "")
    : `http://localhost:${PORT === undefined || PORT === "" ? defaultPort : PORT}`
}/mock/v1`;

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
    AI_BASE_URL: AI_BASE_URL ?? ownMock,
    AI_API_KEY,
    AI_MODEL,
    AI_MOCK_PACE,
    STORAGE_IMPLEMENTATION,
    STORAGE_DIRECTORY,
    STORAGE_BUCKET,
    UPLOAD_LIMIT_BYTES,
    // Where the connection comes from, and the only line the two runtimes disagree on.
    ...(runtime === "cloud"
      ? partsOf(DATABASE_URL)
      : { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD }),
  }),
);
