import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The configuration, read once at boot.
 *
 * **One flat object and one schema since `S7.2`**, which is the one seam of that slice
 * whose cases are rewritten, because its interface is what the person asked to change.
 * Both runtimes are asked for the same `DATABASE_URL`, because `lib/db` hands the
 * driver that string and has no branch below it (D16). What differs is where the string
 * comes from: the laptop's is the throwaway `docker-compose.yml` committed, and the
 * deployed function's is the pooled string Neon issues and Secrets Manager holds (D19).
 *
 * **Nine cases of this file went with the union, and each for the same reason**: it had
 * no subject left. `partsOf` is gone, so the five that asserted a host, a port, a
 * decoded password, a missing string and a local runtime ignoring a connection string
 * assert nothing a person can now get wrong — the driver reads the string, and `lib/db`
 * hands it over whole. And `APP_URL`, `STORAGE_URL` and `DATABASE_URL` have defaults a
 * laptop runs on, so the three cases that proved a half-configured cloud fails its cold
 * start are no longer this module's to make: that guarantee moved to
 * `infra/tests/invariants.test.ts`, which asserts the template sets every one of them
 * (criterion 11). What is left of the pair is the case below that a malformed URL
 * throws at load naming the variable, in either runtime.
 *
 * The provider clients are the other thing both runtimes are asked for, and since SL5
 * the two answer the same way (ID60): every one of the six values, `APP_URL` and
 * `BETTER_AUTH_SECRET` is required in both branches, and a value that is missing fails
 * the start with the field named. The cloud's exemption was temporary and said so — a
 * merge deploys, and the provider secrets did not exist in Secrets Manager before S5.2.
 * They exist now, so the cases that proved a half-configured cloud parses are the
 * opposite cases below (ID60, ID71).
 *
 * `BETTER_AUTH_SECRET` is read here rather than left to the library, which would read
 * the process environment itself behind this module's back (ID71, F4): the value would
 * be right and the boundary wrong. Absent, the library signs every session cookie with
 * its own public default and only warns.
 *
 * Each case reloads the module, because the environment is read at import and frozen.
 */
const load = async (variables: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value);
  return (await import("../src/env")).env;
};

/** Whatever the developer running this happens to have set, unset for every case. */
const nothingSet = {
  APP_RUNTIME: undefined,
  AWS_REGION: undefined,
  PORT: undefined,
  DATABASE_URL: undefined,
  APP_URL: undefined,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
  LINKEDIN_CLIENT_ID: undefined,
  LINKEDIN_CLIENT_SECRET: undefined,
  BETTER_AUTH_SECRET: undefined,
  AI_BASE_URL: undefined,
  AI_API_KEY: undefined,
  AI_MODEL: undefined,
  AI_MOCK_PACE: undefined,
  STORAGE_URL: undefined,
  UPLOAD_LIMIT_BYTES: undefined,
};

/** A registered Google client app, as the person's `.env` names it. Nobody's real one. */
const googleClient = {
  GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

/** The Microsoft Entra app and the LinkedIn app, named the same way. Nobody's either. */
const microsoftClient = {
  MICROSOFT_CLIENT_ID: "test-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "test-microsoft-client-secret",
};
const linkedinClient = {
  LINKEDIN_CLIENT_ID: "test-linkedin-client-id",
  LINKEDIN_CLIENT_SECRET: "test-linkedin-client-secret",
};

/** All three, which is what a laptop must have (SL2). */
const everyClient = { ...googleClient, ...microsoftClient, ...linkedinClient };

/**
 * The secret the library signs its session cookies with (ID71). Nobody's: the laptop's
 * is a committed throwaway (`.env.example`, ID103) and the deployed one is in Secrets
 * Manager. Long enough that the library does not warn about its length.
 */
const authSecret = {
  BETTER_AUTH_SECRET: "test-better-auth-secret-of-a-decent-length",
};

/** Everything either runtime must be given beyond its connection (ID60, ID71). */
const everyValue = { ...everyClient, ...authSecret };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the local runtime", () => {
  it("answers on the Docker container with nothing set but the provider clients", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect(env.DATABASE_URL).toBe("postgresql://jobapp:local_dev_only@localhost:5432/jobapp");
  });

  /**
   * S7.2: the same variable in both runtimes, which is the whole of the person's
   * request. Where the union made a laptop ignore a connection string it happened to
   * have, there is one now and it is taken; the driver reads the host, the credentials
   * and the TLS mode out of it, and `lib/db` has no branch left.
   */
  it("takes a connection string that is set, in this runtime as in the other", async () => {
    const elsewhere = "postgresql://api:elsewhere@somewhere.neon.tech/neondb?sslmode=require";
    const env = await load({ ...nothingSet, ...everyValue, DATABASE_URL: elsewhere });

    expect(env.DATABASE_URL).toBe(elsewhere);
  });

  it("reads the Google client, and where the browser reaches the app", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // The dev server's address, which is where Google sends the browser back to
      // (`/api/auth/callback/google` under it), through the proxy to the API.
      appUrl: env.APP_URL,
    }).toEqual({
      clientId: "test-google-client-id.apps.googleusercontent.com",
      clientSecret: "test-google-client-secret",
      appUrl: "http://localhost:4200",
    });
  });

  /**
   * ID71: the value the library signs its session cookies with, read here because this
   * module is the only reader of the process environment (F4). On a laptop it is the
   * committed throwaway `.env.example` fills in (ID103), so that the end-to-end
   * fixture and the dev server sign with the same one.
   */
  it("reads the secret the library signs its cookies with", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect(env.BETTER_AUTH_SECRET).toBe("test-better-auth-secret-of-a-decent-length");
  });

  /**
   * SL2: the two providers that join Google, read under the same rule. Their apps are
   * registered at S2.1 and their callbacks are `<APP_URL>/api/auth/callback/microsoft`
   * and `.../linkedin`, so the address they share with Google is the one above.
   */
  it("reads the Microsoft and LinkedIn clients", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect({
      microsoftId: env.MICROSOFT_CLIENT_ID,
      microsoftSecret: env.MICROSOFT_CLIENT_SECRET,
      linkedinId: env.LINKEDIN_CLIENT_ID,
      linkedinSecret: env.LINKEDIN_CLIENT_SECRET,
    }).toEqual({
      microsoftId: "test-microsoft-client-id",
      microsoftSecret: "test-microsoft-client-secret",
      linkedinId: "test-linkedin-client-id",
      linkedinSecret: "test-linkedin-client-secret",
    });
  });

  /**
   * ID60: a client secret has no sensible throwaway value the way the database
   * password does, so there is no default and the process refuses to start. The error
   * names the field, because "invalid configuration" sends a person reading the
   * schema and "GOOGLE_CLIENT_ID" sends them to `.env.example`. Seven fields, one rule:
   * the six halves of the three registrations, and the secret the library signs with
   * (ID71), whose local value is the throwaway `.env.example` fills in (ID103).
   */
  it.each(Object.keys(everyValue))(
    "refuses to start without %s, and names the field",
    async (field) => {
      await expect(load({ ...nothingSet, ...everyValue, [field]: undefined })).rejects.toThrow(
        new RegExp(field),
      );
    },
  );

  /**
   * ID114 and ID127, and the whole of criterion 9: a fresh clone runs the AI boundary
   * with nothing set. There is no key to obtain and no account to open, because the
   * base URL points at the application's own mock, mounted in this same process, and
   * the key is a committed throwaway the mock never reads — the precedent
   * `BETTER_AUTH_SECRET` and the database password already set (ID103).
   *
   * The address follows `PORT`, because the mock is served by the same process the port
   * belongs to. It ends at `/mock/v1` and not a segment further: the client appends
   * `/chat/completions` itself.
   */
  it("points the AI at the app's own mock, with no value set and no key", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect({
      baseUrl: env.AI_BASE_URL,
      key: env.AI_API_KEY,
      model: env.AI_MODEL,
      pace: env.AI_MOCK_PACE,
    }).toEqual({
      baseUrl: "http://localhost:3000/mock/v1",
      key: "local_dev_only_the_mock_ignores_it",
      model: "mock-model",
      pace: "tps=40;ttft=400;chunk=3;jitter=0.15",
    });
  });

  it("follows the port, because the mock is served by this same process", async () => {
    const env = await load({ ...nothingSet, ...everyValue, PORT: "4100" });

    expect(env.AI_BASE_URL).toBe("http://localhost:4100/mock/v1");
  });

  it("takes a provider's base URL when one is given, which is the whole switch", async () => {
    const env = await load({
      ...nothingSet,
      ...everyValue,
      AI_BASE_URL: "https://api.openai.com/v1",
      AI_MODEL: "gpt-5",
    });

    expect({ baseUrl: env.AI_BASE_URL, model: env.AI_MODEL }).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5",
    });
  });

  /**
   * ID128: `lib/storage` is chosen by configuration (ID115) and takes its values as
   * arguments, so they are read here and nowhere else. A fresh clone needs none of
   * them: the implementation is the directory a developer runs, and the directory is
   * under the repository, which is why no bucket has to exist for `pnpm dev` to work.
   */
  it("stores uploaded bytes in a directory under the repository, with nothing set", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect(env.STORAGE_URL).toBe(pathToFileURL(resolve(".objects")).href);
  });

  /**
   * S7.2: one URL, and its scheme is which implementation `lib/storage` builds. A
   * scheme neither implementation answers to is a configuration nobody can serve, so it
   * fails at load naming the variable rather than at the first upload.
   */
  it("refuses a storage URL of a scheme no implementation answers to", async () => {
    await expect(
      load({ ...nothingSet, ...everyValue, STORAGE_URL: "https://example.com/objects" }),
    ).rejects.toThrow(/STORAGE_URL/);
  });

  /**
   * ID134, and it is forced rather than chosen: a function URL accepts a 6 MB request,
   * so the document and its multipart overhead must fit under that. The person's own
   * largest CV is 4.5 MB, which is the file the suite uploads. It lives here so a later
   * slice can lower it for one environment without a code change.
   */
  it("refuses an upload over five megabytes, the ceiling a function URL forces", async () => {
    const env = await load({ ...nothingSet, ...everyValue });

    expect(env.UPLOAD_LIMIT_BYTES).toBe(5_242_880);
  });

  it("takes a limit that is set, so an environment can lower it without a code change", async () => {
    const env = await load({ ...nothingSet, ...everyValue, UPLOAD_LIMIT_BYTES: "1024" });

    expect(env.UPLOAD_LIMIT_BYTES).toBe(1024);
  });

  it("refuses an empty value as it refuses a missing one", async () => {
    await expect(load({ ...nothingSet, ...everyValue, GOOGLE_CLIENT_SECRET: "" })).rejects.toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
  });
});

describe("the cloud runtime", () => {
  /** Where the browser reaches the deployed app, and so where each provider sends it back to. */
  const appUrl = { APP_URL: "https://dev.job-application.app" };

  /** The connection the template hands over as one string (D19). */
  const connection = {
    DATABASE_URL:
      "postgresql://api:npg_secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  };

  /** Everything the template sets on the function since S7.2: the seven, and the connection. */
  const deployed = {
    ...nothingSet,
    ...connection,
    ...appUrl,
    ...everyValue,
    // The bucket the template creates, as the one URL whose scheme is the
    // implementation (ID116, ID128, S7.2).
    STORAGE_URL: "s3://jobapp-dev-documents-123456789012",
  };

  /**
   * S7.2: carried whole, rather than split into five fields and rebuilt. `sslmode` is
   * in it and stays in it, which is what makes `lib/db`'s last branch unnecessary.
   */
  it("carries the pooled connection string Secrets Manager holds, whole", async () => {
    const env = await load(deployed);

    expect(env.DATABASE_URL).toBe(connection.DATABASE_URL);
  });

  /**
   * The opposite of the case that stood here until S5.2, and the same sentence read
   * the other way round (ID60). The cloud branch was allowed to lack a provider value
   * only because Secrets Manager did not hold one yet and every merge deploys; now that
   * the template resolves all eight, an absent one is a half-configured function, and
   * the cold start is where that has to be found out rather than the first press of a
   * button (ID23). Eight fields, one rule, and `BETTER_AUTH_SECRET` among them: without
   * it the library signs every session cookie with its own public default and does not
   * even throw, because the deployed function sets no `NODE_ENV` (ID71, F7).
   *
   * `APP_URL` left this list at S7.2 and did not stop being required of the cloud: the
   * flat schema gives it a laptop's default, so what refuses a half-configured function
   * is `infra/tests/invariants.test.ts` asserting the template sets it (criterion 11).
   */
  it.each(Object.keys(everyValue))(
    "fails the cold start without %s, and names the field",
    async (field) => {
      await expect(load({ ...deployed, [field]: undefined })).rejects.toThrow(new RegExp(field));
    },
  );

  it("reads the provider clients, the app's address and the auth secret the template hands over", async () => {
    const env = await load(deployed);

    expect({
      googleId: env.GOOGLE_CLIENT_ID,
      microsoftId: env.MICROSOFT_CLIENT_ID,
      linkedinId: env.LINKEDIN_CLIENT_ID,
      appUrl: env.APP_URL,
      authSecret: env.BETTER_AUTH_SECRET,
    }).toEqual({
      googleId: "test-google-client-id.apps.googleusercontent.com",
      microsoftId: "test-microsoft-client-id",
      linkedinId: "test-linkedin-client-id",
      appUrl: "https://dev.job-application.app",
      authSecret: "test-better-auth-secret-of-a-decent-length",
    });
  });

  /**
   * ID114 says the four AI values are required in the cloud, and SL6 is the slice that
   * supplies them from the template. Between here and there every merge deploys, and a
   * value required before the template sets it fails the cold start of a function that
   * does not yet make a single AI call — the health route with it. So they default in
   * the cloud too, exactly as the provider clients did between SL2 and S5.2. SL6 takes
   * the exception away in the same breath as it puts the values in the template.
   *
   * **And the default is the same string in every runtime** (`S7.1`, `ID150`; the
   * person, 2026-09-12: *"I just dont like environement conditions in the code"*). It
   * used to be computed from `APP_RUNTIME`, so that a deployed function was pointed at
   * `<APP_URL>/mock/v1` — an address the distribution publishes no path to. The double
   * is unreachable in production by design: it ships in the bundle and the deployed
   * function is handed an in-process dispatch as a value at its composition root, so the
   * host in this URL is never dialled there (`ID130`, `SL6`). One address, no branch,
   * and nothing in the API asks which environment it is running in any more.
   */
  it("defaults the AI at the same address whichever runtime it is, because nothing branches", async () => {
    const laptop = await load({ ...nothingSet, ...everyValue });
    const cloud = await load(deployed);

    expect({ baseUrl: cloud.AI_BASE_URL, key: cloud.AI_API_KEY, model: cloud.AI_MODEL }).toEqual({
      baseUrl: laptop.AI_BASE_URL,
      key: "local_dev_only_the_mock_ignores_it",
      model: "mock-model",
    });
  });

  it("takes the values the template hands over when they are there", async () => {
    const env = await load({
      ...deployed,
      AI_BASE_URL: "https://dev.job-application.app/mock/v1",
      AI_API_KEY: "not-read-by-the-mock",
      AI_MODEL: "mock-model",
      AI_MOCK_PACE: "tps=40;ttft=400;chunk=3;jitter=0.15",
    });

    expect(env.AI_BASE_URL).toBe("https://dev.job-application.app/mock/v1");
  });

  /**
   * ID128 in the cloud: the bucket the template creates in this same change (ID116).
   * It is required and has no default, because a function pointed at no bucket, or at a
   * bucket named by a guess, fails at the first upload rather than at the cold start —
   * and the resource and the code arrive together, so there is no window in which
   * requiring it would fail a deploy.
   */
  it("stores uploaded bytes in the bucket the template names", async () => {
    const env = await load(deployed);

    expect(env.STORAGE_URL).toBe("s3://jobapp-dev-documents-123456789012");
  });

  it("fails the cold start when the connection string is not a URL, naming the variable", async () => {
    await expect(load({ ...deployed, DATABASE_URL: "the-secret-was-not-set" })).rejects.toThrow(
      /DATABASE_URL/,
    );
  });
});
