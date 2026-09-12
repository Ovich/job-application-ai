/**
 * Whether a failed insert failed because the row is already there (`S7.3`).
 *
 * It earns a module of its own by the deletion test: complexity that vanishes when the
 * module is deleted was only passing through, and this does not vanish. The whole error
 * chain is read, not the top message — Drizzle wraps the driver's error, and what names
 * the constraint is the driver's, two causes down — and every caller that ever inserts
 * against a unique constraint would have to learn that again, and would get it wrong the
 * same way: reading only the top message turns an intended refusal into a 500.
 *
 * The constraint is the caller's to name, which is what makes the signature clean: this
 * module knows how a driver reports a conflict, and nothing about which table had one.
 *
 * It is reached at its own path rather than through `lib/db`'s index, and deliberately:
 * nine test files stand that index in for wholesale, so an export added there is an
 * export every one of them would have to grow. A file that opens no connection has no
 * business behind a module that does.
 */
export const isDuplicate = (thrown: unknown, constraint: string): boolean => {
  const said: string[] = [];
  for (let cause = thrown; cause instanceof Error; cause = cause.cause) {
    said.push(cause.message, String((cause as { constraint_name?: string }).constraint_name ?? ""));
  }
  return new RegExp(`${constraint}|duplicate key`, "i").test(said.join(" "));
};
