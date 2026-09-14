import postgres from "postgres";

/**
 * `pnpm dev:sql "<sql>" [--write]`: dev's database, from localhost (ID223).
 *
 * An agent checking dev needs to read what the app wrote there, the way it reads the
 * local container. The connection string is the one `pnpm dev:access` wrote into
 * `.env.deployed`, read through `e2e/support/config` so there is one place that knows
 * where it comes from, and the answer is printed as JSON.
 *
 * Dev is one shared database, so a statement runs inside a read-only transaction unless
 * `--write` is passed: an `insert` typed by mistake is refused by PostgreSQL itself, not
 * by a check here. Migrations stay the pipeline's, and do not come through here.
 */

/** Runs one statement on one connection, closed after it; read-only unless `write`. */
export const query = async (url: string, sql: string, write: boolean): Promise<unknown[]> => {
  // `prepare: false`: dev's string is Neon's pooled one, which does not keep prepared
  // statements across the pooler's connections.
  const connection = postgres(url, { max: 1, connect_timeout: 10, prepare: false });
  try {
    const rows = await connection.begin(write ? "read write" : "read only", (tx) => tx.unsafe(sql));
    return [...(rows as unknown as unknown[])];
  } finally {
    await connection.end();
  }
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const [sql] = args.filter((arg) => arg !== "--write");
  try {
    if (sql === undefined || sql.trim() === "") {
      throw new Error('usage: pnpm dev:sql "<sql>" [--write]');
    }
    // Imported by address with its extension, which Node's own TypeScript needs and the
    // compiler's resolution here does not allow in a static import; typed by the module.
    const { deployedSecrets } = (await import(
      new URL("../e2e/support/config.ts", import.meta.url).href
    )) as typeof import("../e2e/support/config");
    // `pnpm` runs the command at the repository's root, where `.env.deployed` lives.
    const rows = await query(deployedSecrets(process.cwd()).databaseUrl, sql, write);
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "pnpm dev:sql failed");
    process.exitCode = 1;
  }
}
