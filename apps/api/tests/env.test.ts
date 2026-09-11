import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The configuration, read once at boot.
 *
 * Both runtimes are asked for the same five connection fields, because `lib/db` builds
 * one options object out of them and no branch below it (D16). What differs is where
 * they come from: the laptop's are the throwaway defaults of `docker-compose.yml`, and
 * the deployed function's arrive as the single pooled connection string Neon issues and
 * Secrets Manager holds (D19).
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
  DATABASE_HOST: undefined,
  DATABASE_PORT: undefined,
  DATABASE_NAME: undefined,
  DATABASE_USER: undefined,
  DATABASE_PASSWORD: undefined,
  APP_URL: undefined,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
  LINKEDIN_CLIENT_ID: undefined,
  LINKEDIN_CLIENT_SECRET: undefined,
  BETTER_AUTH_SECRET: undefined,
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

    expect({
      runtime: env.APP_RUNTIME,
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      database: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
    }).toEqual({
      runtime: "local",
      host: "localhost",
      port: 5432,
      database: "jobapp",
      user: "jobapp",
      password: "local_dev_only",
    });
  });

  it("ignores a connection string, so a shell that has one does not reach the container", async () => {
    const env = await load({
      ...nothingSet,
      ...everyValue,
      DATABASE_URL: "postgresql://api:elsewhere@somewhere.neon.tech/neondb",
    });

    expect({ host: env.DATABASE_HOST, password: env.DATABASE_PASSWORD }).toEqual({
      host: "localhost",
      password: "local_dev_only",
    });
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

  /** Everything the template sets on the function since S5.2: the eight, and the connection. */
  const deployed = {
    ...nothingSet,
    APP_RUNTIME: "cloud",
    ...connection,
    ...appUrl,
    ...everyValue,
  };

  it("takes the pooled connection string Secrets Manager holds", async () => {
    const env = await load(deployed);

    expect({
      runtime: env.APP_RUNTIME,
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      database: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
    }).toEqual({
      runtime: "cloud",
      host: "ep-example-pooler.eu-central-1.aws.neon.tech",
      port: 5432,
      database: "neondb",
      user: "api",
      password: "npg_secret",
    });
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
   */
  it.each(Object.keys({ ...everyValue, ...appUrl }))(
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

  it("reads the port when the string carries one", async () => {
    const env = await load({
      ...deployed,
      DATABASE_URL: "postgresql://api:npg_secret@ep-example-pooler.neon.tech:6543/neondb",
    });

    expect(env.DATABASE_PORT).toBe(6543);
  });

  it("decodes the escapes a password puts in a URL, which a driver must not receive raw", async () => {
    const env = await load({
      ...deployed,
      DATABASE_URL: "postgresql://api:np%40g%2Fsecret@ep-example-pooler.neon.tech/neondb",
    });

    expect(env.DATABASE_PASSWORD).toBe("np@g/secret");
  });

  it("fails the cold start when the connection string is missing, rather than a request", async () => {
    await expect(load({ ...deployed, DATABASE_URL: undefined })).rejects.toThrow();
  });

  it("fails the cold start when the connection string is not a URL", async () => {
    await expect(load({ ...deployed, DATABASE_URL: "the-secret-was-not-set" })).rejects.toThrow();
  });
});
