import * as schema from "@app/db/schema";
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
 * container sits unused, which is also what lets Aurora Serverless pause. A connection
 * failure surfaces as a thrown error from the query that needed it, never as a null
 * instance.
 */
const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD } = env;

const connection = postgres({
  host: DATABASE_HOST,
  port: DATABASE_PORT,
  database: DATABASE_NAME,
  username: DATABASE_USER,
  password: DATABASE_PASSWORD,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

/** The Drizzle instance every handler queries through. */
export const db = drizzle(connection, { schema });
