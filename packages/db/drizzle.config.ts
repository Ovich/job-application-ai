import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit's configuration. This is a development tool, not application
 * configuration: the credentials below are the throwaway ones of the Postgres
 * container in the repository's `docker-compose.yml`, and `DATABASE_URL` overrides
 * them so the same migrations can be pointed at another database. Rule 12 governs
 * the API's runtime configuration; nothing here is shipped.
 */
const { DATABASE_URL } = process.env;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: DATABASE_URL ?? "postgres://jobapp:local_dev_only@localhost:5432/jobapp",
  },
  strict: true,
  verbose: true,
});
