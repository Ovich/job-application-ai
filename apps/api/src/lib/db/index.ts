import * as schema from "@app/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../../env";

/**
 * The database module. It exposes the Drizzle instance and nothing else: which
 * credential the runtime uses, the connection options and the idle timeout are its
 * business alone (ID3).
 *
 * Exactly one connection per container. `max: 1` because a Lambda serves one request
 * at a time, so a wider pool would open connections nobody is waiting on and spend the
 * database's connection budget on them; `idle_timeout` lets the socket go when a warm
 * container sits unused. A connection failure surfaces as a thrown error from the
 * query that needed it, never as a null instance.
 *
 * There is no branch below, and that is D16's seam holding: the deployed function's
 * host, user and password come from the pooled connection string Neon issues and
 * Secrets Manager holds, the laptop's from the container in `docker-compose.yml`, and
 * `env.ts` presents both as the same five values. Only TLS differs, which is a value in
 * the options object.
 */
const connection = postgres({
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  database: env.DATABASE_NAME,
  username: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  // Neon accepts nothing that has not negotiated TLS, and the local container has no
  // certificate to offer, so this follows the runtime. `require` rather than full
  // verification: what proves the endpoint is the connection string itself, which names
  // one project's pooler host and is held as a secret.
  ssl: env.APP_RUNTIME === "cloud" ? "require" : false,
  max: 1,
  idle_timeout: 20,
  // Neon's compute wakes in roughly half a second, where the paused Aurora cluster this
  // replaced took fifteen (D19). The generous timeout stays: it costs nothing on a
  // connection that succeeds, and a cold pooler is still the slowest thing here.
  connect_timeout: 30,
});

/** The Drizzle instance every handler queries through. */
export const db = drizzle(connection, { schema });
