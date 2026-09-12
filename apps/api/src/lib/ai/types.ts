/**
 * The names the AI boundary is spoken to in. They live in their own file because both
 * halves of the boundary use them — the client that sets the case header and the mock
 * that looks a case up — and neither should have to import the other to say what a
 * case is called.
 */

/**
 * What a call is working on: `<feature>.<step>:<input>`, for instance
 * `intake.classify:2026-08-30_cv_FR`. It is a header value on the wire, which a real
 * provider ignores and the mock reads, so the same request works against both and the
 * calling code holds no mock-shaped branch (ID111).
 */
export type CaseName = `${string}.${string}:${string}`;

/** One turn of the conversation, in the shape the wire protocol carries it. */
export type Message = { role: "system" | "user" | "assistant"; content: string };
