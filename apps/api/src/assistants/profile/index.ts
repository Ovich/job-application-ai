import { document, profileItem, provenance, question } from "@app/db";
import { and, asc, countDistinct, eq } from "drizzle-orm";
import type { AssistantDefinition } from "../../lib/agent";

/**
 * The profile assistant (`ID188`, `ID165`): the concrete assistant of the intake, as a
 * value the composition root hands to the conversations route.
 *
 * What it holds is everything the intake says that is stored: the opening, and the
 * opener each question opens with. The sentence and the tail move here unchanged from
 * the browser (`ID164`); the reading card between them is drawn from the profile and
 * never stored (`ID200`).
 *
 * `prompt` is empty and `tools` none until `SL4` reads them.
 */

/** `First, Java.` for the first question, `Next, Java.` once the run has moved on. */
export const openerFor = (asked: { where: string; first: boolean }): string =>
  `${asked.first ? "First" : "Next"}, ${asked.where}.`;

const sentence = (documents: number): string =>
  `I read your ${documents} document${documents === 1 ? "" : "s"}. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.`;

const tail =
  "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.";

/** The form for a person with nothing read yet: the conversation is theirs, not a reading's. */
const nothingRead =
  "I have not read any of your documents yet. Hand them over and I will read them.";

/** Words the product wrote, and says so (`ID200`). */
const scripted = (text: string) => ({ kind: "text" as const, text, scripted: true as const });

export const profileAssistant: AssistantDefinition = {
  name: "profile",
  prompt: "",
  tools: [],
  /**
   * Entry 1: the sentence, the tail, and the first waiting question's opener as its last
   * part (`ID189`). The documents counted are the ones the profile cites, which is the
   * count the profile's own answer gives.
   */
  opening: async (tx, person) => {
    const [cited] = await tx
      .select({ documents: countDistinct(provenance.documentId) })
      .from(provenance)
      .innerJoin(document, eq(provenance.documentId, document.id))
      .where(eq(document.userId, person));
    const documents = cited?.documents ?? 0;
    if (documents === 0) return [scripted(nothingRead)];

    const asked = await tx
      .select({ title: profileItem.title, state: question.state })
      .from(question)
      .innerJoin(profileItem, eq(question.itemId, profileItem.id))
      .where(and(eq(question.userId, person), eq(question.asked, true)))
      .orderBy(asc(question.position), asc(question.id));
    const waiting = asked.find((each) => each.state === "waiting");
    const moved = asked.some((each) => each.state !== "waiting");

    return [
      scripted(sentence(documents)),
      scripted(tail),
      ...(waiting === undefined
        ? []
        : [scripted(openerFor({ where: waiting.title, first: !moved }))]),
    ];
  },
};
