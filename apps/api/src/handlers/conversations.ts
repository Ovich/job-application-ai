import { createFactory } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { type AssistantDefinition, NotYet } from "../lib/agent";
import { entries, open } from "../lib/conversation";
import { asking, refused } from "../lib/session";

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
 * `GET /:assistant?subject=` → `{ id, entries }`: the person's conversation with that
 * assistant, opened with the assistant's opening if it did not exist yet.
 */
export const openConversation = (definitions: AssistantDefinition[]) =>
  factory.createHandlers(
    validator("query", (value, c) => {
      const said = asked.safeParse(value);
      if (!said.success) return c.json({ error: "a subject is a name, or nothing" }, 400);
      return said.data;
    }),
    async (c) => {
      const person = await asking(c);
      if (person === null) return refused(c);

      const definition = definitions.find((each) => each.name === c.req.param("assistant"));
      if (definition === undefined) return c.json({ error: "no such assistant" }, 404);

      try {
        const conversation = await open(
          person,
          definition.name,
          c.req.valid("query").subject ?? null,
          (tx) => definition.opening(tx, person.id),
        );
        return c.json({ id: conversation.id, entries: await entries(conversation) }, 200);
      } catch (thrown) {
        // Nothing to open on yet (`ID202`): the transaction rolled back, nothing is kept.
        if (thrown instanceof NotYet) return c.json({ error: thrown.message }, 409);
        throw thrown;
      }
    },
  );
