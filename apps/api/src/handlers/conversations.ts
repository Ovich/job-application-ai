import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { stream } from "hono/streaming";
import { validator } from "hono/validator";
import { z } from "zod";
import { type AssistantDefinition, NotYet } from "../lib/agent";
import { askStreaming } from "../lib/ai";
import {
  append,
  asMessages,
  type Conversation,
  type Entry,
  entries,
  open,
} from "../lib/conversation";
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

/** A free message: words, trimmed and not empty, about a subject or none. */
const said = z.object({
  text: z.string().trim().min(1),
  subject: z.string().min(1).optional(),
});

/** The sentence a failed reply ends on. What the person wrote is kept (`ID169`). */
const couldNotAnswer = "The assistant could not answer this time. Your message is kept.";

/**
 * The person's conversation with the definition's assistant, opened with its opening if
 * absent, or the answer that refuses it: 401 signed out, 404 no such assistant, 409
 * nothing to open on yet (`ID202`).
 */
const conversationFor = async (
  c: Context,
  definitions: AssistantDefinition[],
  subject: string | undefined,
): Promise<
  | { refusal: Response }
  | { person: Asking; definition: AssistantDefinition; conversation: Conversation }
> => {
  const person = await asking(c);
  if (person === null) return { refusal: refused(c) };

  const definition = definitions.find((each) => each.name === c.req.param("assistant"));
  if (definition === undefined) return { refusal: c.json({ error: "no such assistant" }, 404) };

  try {
    const conversation = await open(person, definition.name, subject ?? null, (tx) =>
      definition.opening(tx, person.id),
    );
    return { person, definition, conversation };
  } catch (thrown) {
    // Nothing to open on yet (`ID202`): the transaction rolled back, nothing is kept.
    if (thrown instanceof NotYet) return { refusal: c.json({ error: thrown.message }, 409) };
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
      if ("refusal" in found) return found.refusal;
      const { conversation } = found;
      return c.json({ id: conversation.id, entries: await entries(conversation) }, 200);
    },
  );

/**
 * `POST /:assistant/messages` `{ text, subject? }` → a stream (`ID163`, `ID169`, `ID170`):
 * the person's entry, the reply's text as it arrives, the reply's entry, done.
 *
 * **The person's entry commits before the model is asked, in its own transaction**, and
 * no transaction is open while the stream runs: the reply's entry is written only once
 * the stream has ended. A call that fails mid-stream therefore keeps the person's words,
 * writes no half reply, and ends on an error frame. A tab closed mid-reply is the same
 * failure, and intended.
 *
 * One step, asked once (`ID182`): `<assistant>.message:<conversation id>#1`. The prompt,
 * the tools and the loop are `SL4`'s.
 */
export const postMessage = (definitions: AssistantDefinition[]) =>
  factory.createHandlers(
    validator("json", (value, c) => {
      const read = said.safeParse(value);
      if (!read.success) return c.json({ error: "say something" }, 400);
      return read.data;
    }),
    async (c) => {
      const { text, subject } = c.req.valid("json");
      const found = await conversationFor(c, definitions, subject);
      if ("refusal" in found) return found.refusal;
      const { definition, conversation } = found;

      const mine = await db.transaction((tx) =>
        append(tx, conversation, "person", [{ kind: "text", text }]),
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
          let reply = "";
          const pieces = askStreaming(asMessages(await entries(conversation)), {
            feature: definition.name,
            step: "message",
            input: `${conversation.id}#1`,
          });
          for await (const piece of pieces) {
            reply += piece;
            await envelope.send({ kind: "text", text: piece });
          }
          const theirs = await db.transaction((tx) =>
            append(tx, conversation, "assistant", [{ kind: "text", text: reply }]),
          );
          await envelope.send({ kind: "entry", entry: onTheWire(theirs) });
          await envelope.send({ kind: "done" });
        } catch {
          await envelope.send({ kind: "error", message: couldNotAnswer });
        } finally {
          envelope.close();
        }
      });
    },
  );
