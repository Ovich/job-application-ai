import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * Seam B of agent-consolidation `SL9` (`S9.1`, `ID223`): `pnpm dev:sql`, crossed as a
 * command against a real PostgreSQL.
 *
 * Dev's database is one shared Neon project, so the command is proven here on the local
 * container `pnpm dev` brings up, never on dev (`ID228`). The `local` project alone
 * collects this file, which is how CI's `e2e-local` job, the one job with a database up,
 * runs it; `pnpm check` runs with none.
 *
 * The command reads `.env.deployed` from where it is run, which `pnpm` makes the
 * repository's root. Each run here is from an empty directory of its own and hands the
 * connection string in the environment it gives the command, so the laptop's own
 * `.env.deployed`, when there is one, is never read and dev is never reached.
 */

const script = fileURLToPath(new URL("../scripts/dev-sql.ts", import.meta.url));

/** The local container's throwaway credentials, as `docker-compose.yml` declares them. */
const localDatabase = "postgres://jobapp:local_dev_only@localhost:5432/jobapp";

/** A table of this run's own, so the writes below touch nothing the dev server keeps. */
const probe = `dev_sql_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

type Ran = { code: number; stdout: string; stderr: string };

let elsewhere: string;

/** `pnpm dev:sql <args>` from an empty directory, with only `env` as its environment. */
const devSql = (args: string[], env: Record<string, string>): Promise<Ran> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd: elsewhere, env },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });

/** The two values `.env.deployed` would hold, pointed at the local container. */
const toLocal = {
  DEPLOYED_DATABASE_URL: localDatabase,
  DEPLOYED_BETTER_AUTH_SECRET: "local_dev_only_not_a_real_secret_00000000",
};

test.beforeAll(async () => {
  elsewhere = mkdtempSync(join(tmpdir(), "dev-sql-"));
  const made = await devSql([`create table ${probe} (said text not null)`, "--write"], toLocal);
  expect(made.stderr).toBe("");
  expect(made.code).toBe(0);
});

test.afterAll(async () => {
  await devSql([`drop table if exists ${probe}`, "--write"], toLocal);
  rmSync(elsewhere, { recursive: true, force: true });
});

test("a select prints its rows as JSON", async () => {
  const ran = await devSql(["select 1 as one, 'dev' as said"], toLocal);

  expect(ran.stderr).toBe("");
  expect(ran.code).toBe(0);
  expect(JSON.parse(ran.stdout)).toEqual([{ one: 1, said: "dev" }]);
});

test("an insert without --write is refused as a read-only transaction", async () => {
  const ran = await devSql([`insert into ${probe} (said) values ('refused')`], toLocal);

  expect(ran.code).not.toBe(0);
  expect(ran.stderr).toMatch(/read-only transaction/);
  const left = await devSql([`select said from ${probe} where said = 'refused'`], toLocal);
  expect(JSON.parse(left.stdout)).toEqual([]);
});

test("an insert with --write is committed", async () => {
  const ran = await devSql([`insert into ${probe} (said) values ('kept')`, "--write"], toLocal);

  expect(ran.stderr).toBe("");
  expect(ran.code).toBe(0);
  const kept = await devSql([`select said from ${probe} where said = 'kept'`], toLocal);
  expect(JSON.parse(kept.stdout)).toEqual([{ said: "kept" }]);
});

test("with no database URL, the error names pnpm dev:access", async () => {
  const ran = await devSql(["select 1"], {});

  expect(ran.code).not.toBe(0);
  expect(ran.stderr).toMatch(/pnpm dev:access/);
});
