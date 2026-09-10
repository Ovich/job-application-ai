import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The configuration, read once at boot (rule 12).
 *
 * Both runtimes are asked for the same five connection fields, because `lib/db` builds
 * one options object out of them and no branch below it (D16). What differs is where
 * they come from: the laptop's are the throwaway defaults of `docker-compose.yml`, and
 * the deployed function's arrive as the single pooled connection string Neon issues and
 * Secrets Manager holds (D19).
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
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the local runtime", () => {
  it("answers on the Docker container with nothing set at all", async () => {
    const env = await load(nothingSet);

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
      DATABASE_URL: "postgresql://api:elsewhere@somewhere.neon.tech/neondb",
    });

    expect({ host: env.DATABASE_HOST, password: env.DATABASE_PASSWORD }).toEqual({
      host: "localhost",
      password: "local_dev_only",
    });
  });
});

describe("the cloud runtime", () => {
  it("takes the pooled connection string Secrets Manager holds, and nothing else", async () => {
    const env = await load({
      ...nothingSet,
      APP_RUNTIME: "cloud",
      DATABASE_URL:
        "postgresql://api:npg_secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    });

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

  it("reads the port when the string carries one", async () => {
    const env = await load({
      ...nothingSet,
      APP_RUNTIME: "cloud",
      DATABASE_URL: "postgresql://api:npg_secret@ep-example-pooler.neon.tech:6543/neondb",
    });

    expect(env.DATABASE_PORT).toBe(6543);
  });

  it("decodes the escapes a password puts in a URL, which a driver must not receive raw", async () => {
    const env = await load({
      ...nothingSet,
      APP_RUNTIME: "cloud",
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
