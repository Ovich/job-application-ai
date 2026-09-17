import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { validator } from "hono/validator";
import { z } from "zod";
import { type AssistantDefinition, NotYet, Refused, run } from "../lib/agent";
import { append, type Conversation, type Entry, entries, open } from "../lib/conversation";
import { db } from "../lib/db";
import { type Asking, asking, refused } from "../lib/session";
import { createEnvelope } from "../lib/stream";

/**
 * The conversations' handlers (`ID163`, `ID186`): what each route proves, written where
 * it is done, as `handlers/intake.ts` writes it.
 *
 * What they accept: the registry of assistant definitions, handed over by the
 * composition root rather than imported, so this file names no concrete assistant and an
 * assistant added later is a value in `app.ts`, not a line here. An `:assistant` no
 * definition names is a 404.
 *
 * **Every conversation is the asking person's.** `lib/conversation` is asked for the
 * person's own, by the session's id, so there is no path here that reads somebody
 * else's.
 */

const factory = createFactory();

const asked = z.object({ subject: z.string().min(1).optional() });

/**
 * A free message: words, trimmed and not empty, about a subject or none, and about an item
 * of the profile or one of its lines, or none (`S8.7`, `ID233`). Anything else the browser
 * sends with `about`, a `where` included, is dropped here.
 */
const said = z.object({
  text: z.string().trim().min(1),
  subject: z.string().min(1).optional(),
  about: z.object({ itemId: z.string().min(1), lineId: z.string().min(1).optional() }).optional(),
});

/** The sentence a failed reply ends on. What the person wrote is kept (`ID169`). */
const couldNotAnswer = "The assistant could not answer this time. Your message is kept.";

/**
 * The person's conversation with the definition's assistant, opened with its opening if
 * absent, or what is missing: the person (401), the assistant (404), or a reading to open
 * on (409, `ID202`). The handlers write the refusal themselves, so each answer keeps its
 * type on `AppType`.
 */
const conversationFor = async (
  c: Context,
  definitions: AssistantDefinition[],
  subject: string | undefined,
): Promise<
  | { missing: "person" | "assistant" }
  | { notYet: string }
  | { person: Asking; definition: AssistantDefinition; conversation: Conversation }
> => {
  const person = await asking(c);
  if (person === null) return { missing: "person" };

  const definition = definitions.find((each) => each.name === c.req.param("assistant"));
  if (definition === undefined) return { missing: "assistant" };

  try {
    const conversation = await open(person, definition.name, subject ?? null, (tx) =>
      definition.opening(tx, person.id),
    );
    return { person, definition, conversation };
  } catch (thrown) {
    // Nothing to open on yet (`ID202`): the transaction rolled back, nothing is kept.
    if (thrown instanceof NotYet) return { notYet: thrown.message };
    throw thrown;
  }
};

/** An entry as `GET` answers it and as the stream carries it. */
const onTheWire = (entry: Entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() });

/**
 * `GET /:assistant?subject=` → `{ id, entries }`: the person's conversation with that
 * assistant, opened with the assistant's opening if it did not exist yet.
 */
export const openConversation = (definitions: AssistantDefinition[]) =>
  factory.createHandlers(
    validator("query", (value, c) => {
      const read = asked.safeParse(value);
      if (!read.success) return c.json({ error: "a subject is a name, or nothing" }, 400);
      return read.data;
    }),
    async (c) => {
      const found = await conversationFor(c, definitions, c.req.valid("query").subject);
      if ("missing" in found && found.missing === "person") return refused(c);
      if ("missing" in found) return c.json({ error: "no such assistant" }, 404);
      if ("notYet" in found) return c.json({ error: found.notYet }, 409);
      const { conversation } = found;
      return c.json({ id: conversation.id, entries: await entries(conversation) }, 200);
    },
  );

/**
 * `POST /:assistant/actions/:action` with the action's input → `{ entries }` (D9): what the
 * person did with the assistant's own tool. **One transaction** opens the conversation when
 * it does not exist yet, runs the action, and appends the person's entry with the parts the
 * action returns, so a failed entry leaves nothing of the action written.
 *
 * 400 for an input the action's schema refuses, or one the action refuses as saying
 * nothing; 404 for an unknown assistant or action, or a thing that is not the person's;
 * 409 before there is anything to open on (`NotYet`).
 */
export const runAction = (definitions: AssistantDefinition[]) =>
  factory.createHandlers(
    validator("json", (value) => value as unknown),
    async (c) => {
      const person = await asking(c);
      if (person === null) return refused(c);

      const definition = definitions.find((each) => each.name === c.req.param("assistant"));
      if (definition === undefined) return c.json({ error: "no such assistant" }, 404);
      const action = definition.actions.find((each) => each.name === c.req.param("action"));
      if (action === undefined) return c.json({ error: "no such action" }, 404);

      const input = action.input.safeParse(c.req.valid("json"));
      if (!input.success) return c.json({ error: `the input does not fit ${action.name}` }, 400);

      try {
        const mine = await db.transaction(async (tx) => {
          const conversation = await open(
            person,
            definition.name,
            null,
            (writer) => definition.opening(writer, person.id),
            tx,
          );
          const said = await action.run(tx, person.id, input.data);
          return append(tx, conversation, "person", said);
        });
        return c.json({ entries: [onTheWire(mine)] }, 200);
      } catch (thrown) {
        if (thrown instanceof NotYet) return c.json({ error: thrown.message }, 409);
        if (thrown instanceof Refused) return c.json({ error: thrown.message }, thrown.status);
        throw thrown;
      }
    },
  );

/**
 * `POST /:assistant/messages` `{ text, subject?, about? }` → a stream (`ID163`, `ID169`,
 * `ID170`): the person's entry, the reply's text as it arrives, the reply's entry, done.
 * With `about`, the person's entry is `[about, text]`, the part resolved by the
 * definition's `about`, and a 404 when it answers `null` or the definition takes no words
 * about anything (`S8.7`, `ID233`, D12).
 *
 * **The person's entry commits before the model is asked, in its own transaction**, and
 * no transaction is open while the stream runs: the reply's entry is written only once
 * the stream has ended. A call that fails mid-stream therefore keeps the person's words,
 * writes no half reply, and ends on an error frame. A tab closed mid-reply is the same
 * failure, and intended.
 *
 * The reply is `lib/agent`'s agent (`ID187`, D18): each step's text streams on as it arrives,
 * and each of its entries once the step has committed. Step `n` is asked as
 * `<assistant>.message:<conversation id>#<n>` (`ID182`); what earlier steps committed
 * stays when a later one fails.
 */
export const postMessage = (definitions: AssistantDefinition[]) =>
  factory.createHandlers(
    validator("json", (value, c) => {
      const read = said.safeParse(value);
      if (!read.success) return c.json({ error: "say something" }, 400);
      return read.data;
    }),
    async (c) => {
      const { text, subject, about } = c.req.valid("json");
      const found = await conversationFor(c, definitions, subject);
      if ("missing" in found && found.missing === "person") return refused(c);
      if ("missing" in found) return c.json({ error: "no such assistant" }, 404);
      if ("notYet" in found) return c.json({ error: found.notYet }, 409);
      const { person, definition, conversation } = found;

      // What the words are about, resolved by the definition (`S8.7`, `ID233`, D12).
      const resolve = definition.about;
      const aboutIt =
        about === undefined
          ? undefined
          : resolve === undefined
            ? null
            : await db.transaction((tx) => resolve(tx, person.id, about));
      if (aboutIt === null) return c.json({ error: "no such item" }, 404);

      const mine = await db.transaction((tx) =>
        append(tx, conversation, "person", [
          ...(aboutIt === undefined ? [] : [aboutIt]),
          { kind: "text", text },
        ]),
      );

      // The raw stream helper and the headers the server-sent-event one would set, as the
      // reading run sets them: the envelope writes its own `id:` and `data:` lines.
      c.header("content-type", "text/event-stream");
      c.header("cache-control", "no-cache");
      c.header("x-accel-buffering", "no");

      return stream(c, async (response) => {
        const envelope = createEnvelope(async (chunk) => {
          await response.write(chunk);
        });
        response.onAbort(() => {
          envelope.close();
        });

        try {
          await envelope.send({ kind: "entry", entry: onTheWire(mine) });
          for await (const ran of run(definition, conversation, person.id)) {
            // What the agent is doing travels as a status leaf and is never stored (`ID210`).
            await envelope.send(
              ran.kind === "entry"
                ? { kind: "entry", entry: onTheWire(ran.entry) }
                : ran.kind === "activity"
                  ? { kind: "status", text: ran.text }
                  : ran,
            );
          }
          await envelope.send({ kind: "done" });
        } catch {
          await envelope.send({ kind: "error", message: couldNotAnswer });
        } finally {
          envelope.close();
        }
      });
    },
  );
