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
 * The Google client is the other thing both runtimes are asked for, and the two answer
 * differently on purpose (ID60, amended for this slice): the laptop must have one,
 * because a client secret has no throwaway value the way a database password does,
 * and the cloud may lack one until slice 5 puts the secrets in Secrets Manager, so a
 * merge in between keeps the health route answering.
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
};

/** A registered Google client app, as the person's `.env` names it. Nobody's real one. */
const googleClient = {
  GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the local runtime", () => {
  it("answers on the Docker container with nothing set but the Google client", async () => {
    const env = await load({ ...nothingSet, ...googleClient });

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
      ...googleClient,
      DATABASE_URL: "postgresql://api:elsewhere@somewhere.neon.tech/neondb",
    });

    expect({ host: env.DATABASE_HOST, password: env.DATABASE_PASSWORD }).toEqual({
      host: "localhost",
      password: "local_dev_only",
    });
  });

  it("reads the Google client, and where the browser reaches the app", async () => {
    const env = await load({ ...nothingSet, ...googleClient });

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
   * ID60: a client secret has no sensible throwaway value the way the database
   * password does, so there is no default and the process refuses to start. The error
   * names the field, because "invalid configuration" sends a person reading the
   * schema and "GOOGLE_CLIENT_ID" sends them to `.env.example`.
   */
  it("refuses to start without a Google client id, and names the field", async () => {
    await expect(
      load({ ...nothingSet, GOOGLE_CLIENT_SECRET: googleClient.GOOGLE_CLIENT_SECRET }),
    ).rejects.toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("refuses to start without a Google client secret, and names the field", async () => {
    await expect(
      load({ ...nothingSet, GOOGLE_CLIENT_ID: googleClient.GOOGLE_CLIENT_ID }),
    ).rejects.toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("refuses an empty value as it refuses a missing one", async () => {
    await expect(
      load({ ...nothingSet, ...googleClient, GOOGLE_CLIENT_SECRET: "" }),
    ).rejects.toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe("the cloud runtime", () => {
  /** The one value the template sets today (D19); nothing about Google is in it yet. */
  const pooledOnly = {
    ...nothingSet,
    APP_RUNTIME: "cloud",
    DATABASE_URL:
      "postgresql://api:npg_secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  };

  it("takes the pooled connection string Secrets Manager holds, and nothing else", async () => {
    const env = await load(pooledOnly);

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
   * Until slice 5, and only until then. A merge to `main` deploys, and the Google
   * secrets do not exist in Secrets Manager before S5.2; a cloud branch that required
   * them today would fail every cold start between this slice and that one, health
   * route included. S5.2 turns these into required fields and this test into its
   * opposite.
   */
  it("parses without a Google client, until slice 5 puts the secrets in the cloud", async () => {
    const env = await load(pooledOnly);

    expect({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }).toEqual({
      clientId: undefined,
      clientSecret: undefined,
    });
    expect(env.APP_URL).toBeUndefined();
  });

  it("reads the Google client and the app's address when the template hands them over", async () => {
    const env = await load({
      ...pooledOnly,
      ...googleClient,
      APP_URL: "https://dev.job-application.app",
    });

    expect({ clientId: env.GOOGLE_CLIENT_ID, appUrl: env.APP_URL }).toEqual({
      clientId: "test-google-client-id.apps.googleusercontent.com",
      appUrl: "https://dev.job-application.app",
    });
  });

  it("reads the port when the string carries one", async () => {
    const env = await load({
      ...pooledOnly,
      DATABASE_URL: "postgresql://api:npg_secret@ep-example-pooler.neon.tech:6543/neondb",
    });

    expect(env.DATABASE_PORT).toBe(6543);
  });

  it("decodes the escapes a password puts in a URL, which a driver must not receive raw", async () => {
    const env = await load({
      ...pooledOnly,
      DATABASE_URL: "postgresql://api:np%40g%2Fsecret@ep-example-pooler.neon.tech/neondb",
    });

    expect(env.DATABASE_PASSWORD).toBe("np@g/secret");
  });

  it("fails the cold start when the connection string is missing, rather than a request", async () => {
    await expect(load({ ...nothingSet, APP_RUNTIME: "cloud" })).rejects.toThrow();
  });

  it("fails the cold start when the connection string is not a URL", async () => {
    await expect(
      load({ ...nothingSet, APP_RUNTIME: "cloud", DATABASE_URL: "the-secret-was-not-set" }),
    ).rejects.toThrow();
  });
});
