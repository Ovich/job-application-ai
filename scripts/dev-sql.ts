import postgres from "postgres";

/**
 * `pnpm dev:sql "<sql>" [--write]`: dev's database, from localhost (ID223, ID231).
 *
 * An agent checking dev needs to read what the app wrote there, the way it reads the
 * local container. The connection string is the one `pnpm dev:access` wrote into
 * `.jobapp/dev.env` in the person's profile, read through `e2e/support/config` so there is
 * one place that knows where it comes from, and the answer is printed as JSON.
 *
 * Dev is one shared database, so a statement runs inside a read-only transaction unless
 * `--write` is passed: an `insert` typed by mistake is refused by PostgreSQL itself, not
 * by a check here. That holds only for one statement: a text of two sent as one query
 * lets the first, a `commit`, end the transaction and the second write. So a text of more
 * than one is refused before anything is sent, and the one statement goes by the extended
 * protocol, which PostgreSQL itself refuses more than one command on. Migrations stay the
 * pipeline's, and do not come through here.
 */

const identifierChar = /[A-Za-z0-9_$-￿]/;
const dollarTag = /\$(?:[A-Za-z_-￿][A-Za-z0-9_-￿]*)?\$/y;

/** Where the quoted run opening at `start` with `quote` ends, `'` and `"` doubled inside. */
const endOfQuoted = (sql: string, start: number, quote: string, backslashes: boolean): number => {
  let at = start + 1;
  while (at < sql.length) {
    const char = sql.charAt(at);
    if (backslashes && char === "\\") at += 2;
    else if (char === quote && sql.charAt(at + 1) === quote) at += 2;
    else if (char === quote) return at + 1;
    else at += 1;
  }
  return sql.length;
};

/** Where the comment opening at `start` ends: `--` to the line's end, `/* *\/` nested. */
const endOfComment = (sql: string, start: number): number => {
  if (sql.startsWith("--", start)) {
    const line = sql.indexOf("\n", start);
    return line === -1 ? sql.length : line + 1;
  }
  let depth = 0;
  let at = start;
  while (at < sql.length) {
    if (sql.startsWith("/*", at)) {
      depth += 1;
      at += 2;
    } else if (sql.startsWith("*/", at)) {
      depth -= 1;
      at += 2;
      if (depth === 0) return at;
    } else at += 1;
  }
  return sql.length;
};

/**
 * How many statements `sql` holds, its semicolons read as PostgreSQL's lexer reads them:
 * not inside a string, an `E''` string's backslash escapes, a quoted identifier, a
 * dollar-quoted body or a comment. Where this could read the text differently from
 * PostgreSQL, it reads a semicolon as a separator, so a doubt is a refusal.
 */
const statements = (sql: string): number => {
  let count = 0;
  let open = false;
  let at = 0;
  while (at < sql.length) {
    const char = sql.charAt(at);
    const before = sql.charAt(at - 1);
    if (/\s/.test(char)) {
      at += 1;
    } else if (sql.startsWith("--", at) || sql.startsWith("/*", at)) {
      at = endOfComment(sql, at);
    } else if (char === ";") {
      if (open) count += 1;
      open = false;
      at += 1;
    } else {
      open = true;
      if (char === "'") {
        const escaped = /[eE]/.test(before) && !identifierChar.test(sql.charAt(at - 2));
        at = endOfQuoted(sql, at, "'", escaped);
      } else if (char === '"') {
        at = endOfQuoted(sql, at, '"', false);
      } else if (char === "$" && !identifierChar.test(before)) {
        dollarTag.lastIndex = at;
        const tag = dollarTag.exec(sql)?.[0];
        if (tag === undefined) at += 1;
        else {
          const close = sql.indexOf(tag, at + tag.length);
          at = close === -1 ? sql.length : close + tag.length;
        }
      } else if (identifierChar.test(char)) {
        while (at < sql.length && identifierChar.test(sql.charAt(at))) at += 1;
      } else {
        at += 1;
      }
    }
  }
  return count + (open ? 1 : 0);
};

/**
 * `simple: false` sends the statement by the extended protocol even with no parameters;
 * the library's types do not name the option, so it is handed over as a value.
 */
const extendedProtocol = { prepare: false, simple: false };

/**
 * Runs exactly one statement on one connection, closed after it; read-only unless
 * `write`. A text of more than one is refused before a connection is opened.
 */
export const query = async (url: string, sql: string, write: boolean): Promise<unknown[]> => {
  if (statements(sql) > 1) {
    throw new Error(
      "pnpm dev:sql runs exactly one statement, and this text holds more than one: nothing sent",
    );
  }
  // `prepare: false`: dev's string is Neon's pooled one, which does not keep prepared
  // statements across the pooler's connections.
  const connection = postgres(url, { max: 1, connect_timeout: 10, prepare: false });
  try {
    const rows = await connection.begin(write ? "read write" : "read only", (tx) =>
      tx.unsafe(sql, [], extendedProtocol),
    );
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
    const rows = await query(deployedSecrets().databaseUrl, sql, write);
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "pnpm dev:sql failed");
    process.exitCode = 1;
  }
}
