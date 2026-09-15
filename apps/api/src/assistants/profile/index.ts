/// <reference path="../../text.d.ts" />
import {
  aboutPart,
  document,
  itemLine,
  type Part,
  profileItem,
  provenance,
  question,
  questionAnsweredPart,
  questionSkippedPart,
} from "@app/db";
import { and, asc, countDistinct, eq } from "drizzle-orm";
import { type AssistantDefinition, NotYet } from "../../lib/agent";
import { itemsOf, profileEditTool } from "../../lib/profile-edit";
import prompt from "./prompt.md" with { type: "text" };

/**
 * The profile assistant (`ID188`, `ID165`): the concrete assistant of the intake, as a
 * value the composition root hands to the conversations route.
 *
 * What it holds is everything the intake says that is stored: the opening, and the
 * opener each question opens with. The sentence and the tail move here unchanged from
 * the browser (`ID164`); the reading card between them is drawn from the profile and
 * never stored (`ID200`).
 *
 * Its system prompt is `prompt.md` beside this file, imported as text so it is inside the
 * bundle (`ID181`, `ID188`); its one tool is the shared profile edit (`ID187`).
 */

/** `First, Java.` for the first question, `Next, Java.` once the run has moved on. */
export const openerFor = (asked: { where: string; first: boolean }): string =>
  `${asked.first ? "First" : "Next"}, ${asked.where}.`;

const sentence = (documents: number): string =>
  `I read your ${documents} document${documents === 1 ? "" : "s"}. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.`;

const tail =
  "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.";

/** Words the product wrote, and says so (`ID200`). */
const scripted = (text: string) => ({ kind: "text" as const, text, scripted: true as const });

/**
 * A part of the person's entry beyond their text, in the words the model reads (`S7.2`,
 * D11): what the words after it are about, with the ids a tool call targets (`S8.7`,
 * `ID233`), and their use of the assistant's tool said as they would say it.
 */
const describe = (part: Part): string | null => {
  const about = aboutPart.safeParse(part);
  if (about.success) {
    const { where, itemId, lineId } = about.data;
    const line = lineId === undefined ? "" : `, lineId ${lineId}`;
    return `About "${where}" (itemId ${itemId}${line}):`;
  }
  const answered = questionAnsweredPart.safeParse(part);
  if (answered.success) {
    const { lead, where, options, picked, words } = answered.data;
    const option = options.find((each) => each.id === picked);
    const asked = `I answered "${lead}" (${where})`;
    if (option === undefined) return `${asked} in my own words: ${words ?? ""}`;
    const chose = `${asked}: ${option.label} (${option.hint}).`;
    return words === null ? chose : `${chose} In my own words: ${words}`;
  }
  const skipped = questionSkippedPart.safeParse(part);
  if (skipped.success) {
    return `I skipped "${skipped.data.lead}" (${skipped.data.where}) for now, without answering it.`;
  }
  return null;
};

export const profileAssistant: AssistantDefinition = {
  name: "profile",
  prompt,
  tools: [profileEditTool],
  /**
   * The profile as it stands, as the model reads it (`ID193`, D10), read fresh before each
   * step, so a step sees what the step before it changed.
   */
  context: async (tx, person) => [
    `The person's profile as it stands, as JSON. Every item, and every line of an item, carries the id an edit names it by.\n${JSON.stringify(await itemsOf(tx, person))}`,
  ],
  /** What a step is doing before its first words: the first reads the profile, a later one what changed. */
  stepPhrase: (n) => (n === 1 ? "Reading your profile" : "Reading what changed"),
  describe,
  /**
   * Where the words are, composed from the person's own profile (D12): the item's title,
   * and for a line `<title> · row <n>`, the row counted as the sheet counts it. `null` when
   * the item is not the person's or the line not the item's.
   */
  about: async (tx, person, { itemId, lineId }) => {
    const [item] = await tx
      .select({ id: profileItem.id, title: profileItem.title })
      .from(profileItem)
      .where(and(eq(profileItem.id, itemId), eq(profileItem.userId, person)));
    if (item === undefined) return null;
    if (lineId === undefined) return { kind: "about", itemId, where: item.title };
    const lines = await tx
      .select({ id: itemLine.id })
      .from(itemLine)
      .where(eq(itemLine.itemId, item.id))
      .orderBy(asc(itemLine.position));
    const at = lines.findIndex((line) => line.id === lineId);
    return at === -1
      ? null
      : { kind: "about", itemId, lineId, where: `${item.title} · row ${at + 1}` };
  },
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
    // No assistant during the profile intake (`ID202`): before a reading there is no
    // conversation, so nothing is stored that was never true.
    if (documents === 0) throw new NotYet("nothing read yet");

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
