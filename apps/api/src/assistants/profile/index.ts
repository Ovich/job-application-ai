/// <reference path="../../text.d.ts" />
import { randomUUID } from "node:crypto";
import {
  aboutPart,
  document,
  itemLine,
  type ProfileConcernKind,
  type ProfileConcernSource,
  profileConcern,
  profileItem,
  provenance,
  question,
  questionAnsweredPart,
  questionOption,
  questionSkippedPart,
} from "@app/db";
import { and, asc, countDistinct, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { type AgentAction, type Assistant, NotYet, Refused } from "../../lib/assistant";
import type { Transaction } from "../../lib/conversation";
import { profileEditTool, profileReadTool } from "../../lib/profile-edit";
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
 * bundle (`ID181`, `ID188`); its tools are the shared profile read and edit (`ID187`,
 * `ID301`).
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
const describe = (part: Record<string, unknown>): string | null => {
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

/** `Kubernetes: shipping to a cluster run by others` — the item, then what was said. */
const concernAbout = (title: string, words: string): string => `${title}: ${words}`;

/**
 * A profile concern kept, and the one it supersedes.
 *
 * **Inserted, never updated.** Answering again writes a new row and marks the old one
 * superseded, so the history of what the person said survives being changed (`ID121`).
 * An `update` here would pass every test that reads only the current concern and quietly
 * destroy the one thing this table exists to keep.
 */
const keepAsConcern = async (
  tx: Transaction,
  kept: {
    userId: string;
    itemId: string;
    kind: ProfileConcernKind;
    text: string;
    source: ProfileConcernSource;
    questionId: string | null;
  },
): Promise<void> => {
  const id = randomUUID();
  await tx.insert(profileConcern).values({ id, ...kept });
  await tx
    .update(profileConcern)
    .set({ supersededBy: id })
    .where(
      and(
        eq(profileConcern.itemId, kept.itemId),
        eq(profileConcern.userId, kept.userId),
        isNull(profileConcern.supersededBy),
        ne(profileConcern.id, id),
      ),
    );
};

/**
 * The question as the person was asked it, and every option offered, as the entry that
 * records their answer or their skip carries it (`SL7`). The concern each option would write
 * stays out: it is the intake's, not what the person saw.
 */
const asAsked = async (tx: Transaction, row: { id: string; lead: string; where: string }) => ({
  lead: row.lead,
  where: row.where,
  options: await tx
    .select({ id: questionOption.id, label: questionOption.label, hint: questionOption.hint })
    .from(questionOption)
    .where(eq(questionOption.questionId, row.id))
    .orderBy(asc(questionOption.position), asc(questionOption.id)),
});

/**
 * The person's own question, or a 404. Never a 403, which would confirm that somebody
 * else's question exists; a question whose item was removed went with it by cascade.
 */
const theirQuestion = async (tx: Transaction, person: string, questionId: string) => {
  const [row] = await tx
    .select()
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.userId, person)));
  if (row === undefined) throw new Refused("no such question", 404);
  return row;
};

/**
 * `answer_question` (D9, `S4.3`, `US6`): a row picked, the person's words, or both. The
 * question is answered and the item's profile concern kept: the picked row's own concern,
 * with the words beside it when they typed as well. The last row carries none, so picking it
 * is the same as saying it yourself, and saying nothing is a 400 (`ID246`).
 */
const answerQuestion: AgentAction<{
  questionId: string;
  optionId?: string | undefined;
  words?: string | undefined;
}> = {
  name: "answer_question",
  input: z.object({
    questionId: z.string().min(1),
    optionId: z.string().min(1).optional(),
    words: z.string().optional(),
  }),
  run: async (tx, person, { questionId, optionId, words: typed }) => {
    const row = await theirQuestion(tx, person, questionId);
    const words = (typed ?? "").trim();
    const [option] =
      optionId === undefined
        ? []
        : await tx
            .select()
            .from(questionOption)
            .where(and(eq(questionOption.id, optionId), eq(questionOption.questionId, row.id)));
    if (optionId !== undefined && option === undefined) throw new Refused("no such answer", 404);

    const [item] = await tx.select().from(profileItem).where(eq(profileItem.id, row.itemId));
    if (item === undefined) throw new Refused("no such question", 404);

    const picked = option?.concern ?? null;
    if (picked === null && words === "") {
      throw new Refused("pick a row, or say it in your own words", 400);
    }
    const text =
      picked === null
        ? concernAbout(item.title, words)
        : words === ""
          ? picked
          : `${picked} — ${words}`;

    const asked = await asAsked(tx, row);
    await keepAsConcern(tx, {
      userId: person,
      itemId: row.itemId,
      // A scope question asks what the person's part was; a conflict and a provenance
      // question both settle what may never be claimed (D14).
      kind: row.kind === "scope" ? "scope" : "constraint",
      text,
      source: picked === null ? "own words" : "answer",
      questionId: row.id,
    });
    await tx
      .update(question)
      .set({ state: "answered", answeredAt: new Date() })
      .where(eq(question.id, row.id));
    return [
      {
        kind: "question_answered",
        ...asked,
        picked: option?.id ?? null,
        words: words === "" ? null : words,
      },
    ];
  },
};

/**
 * `skip_question` (D9, `S4.4`, `US7`): the question put off, kept and not deleted, offered
 * again the first time a CV needs it. No profile concern is kept (D14).
 */
const skipQuestion: AgentAction<{ questionId: string }> = {
  name: "skip_question",
  input: z.object({ questionId: z.string().min(1) }),
  run: async (tx, person, { questionId }) => {
    const row = await theirQuestion(tx, person, questionId);
    const asked = await asAsked(tx, row);
    await tx.update(question).set({ state: "skipped" }).where(eq(question.id, row.id));
    return [{ kind: "question_skipped", ...asked }];
  },
};

export const profileAssistant: Assistant = {
  name: "profile",
  prompt,
  // The profile is read through the tool, never sent ahead of the history (D33).
  tools: [profileReadTool, profileEditTool],
  // Each typed by its own input, and listed as the definition takes them, as the tools are.
  actions: [answerQuestion as AgentAction, skipQuestion as AgentAction],
  /**
   * What a step is doing before its first words. It claims no read: a read is a call, and
   * says so itself while it runs.
   */
  stepPhrase: (n) => (n === 1 ? "Thinking about your message" : "Thinking it through"),
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
