import * as schema from "@app/db/schema";
import { Signer } from "@aws-sdk/rds-signer";
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
const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER } = env;

/**
 * How the runtime proves who it is, and the only line where the two differ.
 *
 * The driver accepts a function where it accepts a password, and calls it once per
 * connection. That is what makes an identity token workable without any expiry
 * handling: a token lives fifteen minutes, a connection is opened well inside that, and
 * a reconnect mints a fresh one. There is no cache to invalidate and no clock to watch.
 *
 * The laptop passes the throwaway string from the compose file instead. The difference
 * is a value in an options object, not a branch in any code path below.
 */
const tokenPerConnection = (region: string) => {
  const signer = new Signer({
    region,
    hostname: DATABASE_HOST,
    port: DATABASE_PORT,
    username: DATABASE_USER,
  });
  return () => signer.getAuthToken();
};

const password =
  env.APP_RUNTIME === "cloud" ? tokenPerConnection(env.AWS_REGION) : env.DATABASE_PASSWORD;

const connection = postgres({
  host: DATABASE_HOST,
  port: DATABASE_PORT,
  database: DATABASE_NAME,
  username: DATABASE_USER,
  password,
  // The cluster refuses a connection that does not negotiate TLS (`rds.force_ssl`), and
  // the local container has no certificate to offer, so this follows the runtime too.
  // `require` rather than full verification: the endpoint's certificate is signed by
  // Amazon's RDS authority, which is not in the Node trust store, and pinning it would
  // mean shipping and rotating a bundle for a connection whose identity is already
  // proven by a token minted for this host.
  ssl: env.APP_RUNTIME === "cloud" ? "require" : false,
  max: 1,
  idle_timeout: 20,
  // A paused cluster takes about fifteen seconds to wake, which the spec's failure
  // table accepts by name. Ten seconds would time out on exactly that.
  connect_timeout: 30,
});

/** The Drizzle instance every handler queries through. */
export const db = drizzle(connection, { schema });
