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
 * `env.ts` presents both as one `DATABASE_URL` this module cannot tell apart.
 *
 * TLS was the one line that differed, and it differs no longer (S7.2): Neon accepts
 * nothing that has not negotiated TLS and says so in its own string, as `sslmode`,
 * which the driver reads; the local container has no certificate to offer and its
 * string carries no `sslmode`, so the same code negotiates nothing. `require` rather
 * than full verification: what proves the endpoint is the connection string itself,
 * which names one project's pooler host and is held as a secret.
 */
const connection = postgres(env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  // Neon's compute wakes in roughly half a second, where the paused Aurora cluster this
  // replaced took fifteen (D19). The generous timeout stays: it costs nothing on a
  // connection that succeeds, and a cold pooler is still the slowest thing here.
  connect_timeout: 30,
});

/** The Drizzle instance every handler queries through. */
export const db = drizzle(connection, { schema });
