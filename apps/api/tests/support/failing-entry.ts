import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { testDb } from "./database";

/**
 * An injected failure, on the real transaction (`ID171`, `ID192`).
 *
 * A trigger that raises on insert into `conversation_entry` when the entry's `parts`
 * hold `marker` anywhere — a text, or a tool call's input — so a case proves that an
 * edit and the entry that records it never disagree (`US6`) against PostgreSQL's own
 * rollback rather than a mocked `db`. The trigger and its function are dropped on
 * `dispose`, so one case's failure never reaches another's.
 */

/** The database a case injects into: the suite's own. */
type TestDb = typeof testDb;

export const failingOn = async (
  db: TestDb,
  marker: string,
): Promise<{ dispose: () => Promise<void> }> => {
  // The marker is written into the function's body, so it is held to characters that
  // cannot close a string or a statement.
  if (!/^[A-Za-z0-9_-]+$/.test(marker)) {
    throw new Error(`a failure marker is letters, digits, dashes and underscores: ${marker}`);
  }
  const name = `failing_entry_${randomUUID().replaceAll("-", "")}`;
  await db.execute(
    sql.raw(
      `create function ${name}() returns trigger language plpgsql as $$ begin if new.parts::text like '%${marker}%' then raise exception 'injected failure on an entry holding ${marker}'; end if; return new; end $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `create trigger ${name} before insert on conversation_entry for each row execute function ${name}()`,
    ),
  );
  return {
    dispose: async () => {
      await db.execute(sql.raw(`drop trigger ${name} on conversation_entry`));
      await db.execute(sql.raw(`drop function ${name}()`));
    },
  };
};
