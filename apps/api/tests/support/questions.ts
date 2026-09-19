import { randomUUID } from "node:crypto";
import {
  document,
  type ItemKind,
  itemEntry,
  itemExperience,
  profileItem,
  provenance,
  type QuestionKind,
  question,
  questionOption,
} from "@app/db";
import { asc, eq } from "drizzle-orm";
import { testDb } from "./database";

/**
 * The suite's own question fixture (`S3.0`): a person holding the questions a reading
 * would have left them, written directly.
 *
 * **It exists so that a suite whose subject is not the reading stops running one.** Four
 * suites needed a question to exist before they could test an answer, a skip, an opening
 * or an erasure, and the only way to get one was to upload documents and run a whole
 * reading. The question was never the subject there — it is the precondition — so it is
 * written here, and the reading is left to the suites that are actually about it
 * (`intake-read`, `intake-questions`).
 *
 * **What it writes is what a question cannot exist without.** A `question` row points at
 * a `profile_item` through a foreign key, so the item is written when the person has none
 * by that title; and the profile assistant refuses to open a conversation for a person
 * whose profile cites no document (`nothing read yet`, `ID202`), so each item it writes is
 * cited by every document the person already holds. It creates no document of its own: a
 * caller hands the documents over first, as a person does.
 *
 * **The questions are the ones the shipped case proposes**, in its order and its wording,
 * because that is what the suites in scope were already reading back through
 * `GET /api/intake/profile`. The words are the reader's, copied from the recorded answer
 * for the person's own three CVs, so a case that names an option's concern still names the
 * concern a real reading would have written.
 *
 * **A person's questions are this fixture's.** Any question already standing is removed
 * before these are written, so calling it after a reading leaves the person holding these
 * four and not eight. Once the reading no longer writes questions (`S3.1`) that removal is
 * a no-op.
 */

/** One row a question offers. The last one carries no concern: it is the person's words. */
type Offered = { label: string; hint: string; concern?: string };

/** One question as the reader proposes it, with the item it hangs on and where it sits. */
type Asked = {
  item: { kind: ItemKind; title: string; under?: string };
  kind: QuestionKind;
  where: string;
  lead: string;
  options: Offered[];
};

/**
 * The four the shipped case proposes for the person's own three CVs, in order: two about
 * scope, one about a conflict between two CVs, one about provenance.
 */
const theQuestions: readonly Asked[] = [
  {
    item: { kind: "entry", title: "Kubernetes", under: "DevOps and cloud" },
    kind: "scope",
    where: "What you work with · DevOps and cloud · in 2 documents",
    lead: "Kubernetes is in two of your documents and neither says your part. Which was it?",
    options: [
      {
        label: "Ran the cluster",
        hint: "nodes, upgrades, access",
        concern: "Kubernetes: cluster administration, and the services on it",
      },
      {
        label: "Ran services on it",
        hint: "deployed and operated the workloads",
        concern: "Kubernetes: deploying and running services, never cluster administration",
      },
      {
        label: "Used it as a developer",
        hint: "shipped to a cluster someone else ran",
        concern: "Kubernetes: shipping to a cluster run by others",
      },
      { label: "Something else", hint: "say it below" },
    ],
  },
  {
    item: { kind: "entry", title: "Observability & Monitoring", under: "DevOps and cloud" },
    kind: "scope",
    where: "What you work with · DevOps and cloud · in 1 document",
    lead: "Observability is on your lab track and in one CV line. Did you set it up, run it, or read it?",
    options: [
      {
        label: "Set it up",
        hint: "chose and installed the stack",
        concern: "Observability: set up the stack",
      },
      {
        label: "Ran it",
        hint: "kept it working, alerts, dashboards",
        concern: "Observability: operated it, alerts and dashboards",
      },
      {
        label: "Used it for insights",
        hint: "read it to understand how the apps behaved",
        concern: "Observability: read it to understand the apps, never operated it",
      },
      { label: "Something else", hint: "say it below" },
    ],
  },
  {
    item: { kind: "experience", title: "R&D Collaborator in Software Engineering" },
    kind: "conflict",
    where: "Experience · HEIG-VD, 2022 to 2026 · 2 documents disagree",
    lead: "Your 2022 CV says Assistant HES, your 2025 CV says R&D Collaborator in Software Engineering. Which was on your contract?",
    options: [
      {
        label: "Assistant HES",
        hint: "the 2022 CV",
        concern: "HEIG-VD: Assistant HES, the contract title",
      },
      {
        label: "R&D Collaborator in Software Engineering",
        hint: "the 2025 CV",
        concern: "HEIG-VD: R&D Collaborator in Software Engineering, the contract title",
      },
      {
        label: "Both, at different times",
        hint: "say when below",
        concern: "HEIG-VD: Assistant HES, then R&D Collaborator in Software Engineering",
      },
      { label: "Something else", hint: "say it below" },
    ],
  },
  {
    item: { kind: "entry", title: "Terraform", under: "Infrastructure as code" },
    kind: "provenance",
    where: "What you work with · Infrastructure as code · in 1 document",
    lead: "Terraform is named once, in a course list. Is that where it stops?",
    options: [
      {
        label: "Only the course",
        hint: "studied and examined, never in production",
        concern: "Terraform: covered in a course, never production",
      },
      {
        label: "Used it on a project",
        hint: "say which one below",
        concern: "Terraform: used on a project, never production infrastructure I own",
      },
      {
        label: "I run it in production",
        hint: "infrastructure I own",
        concern: "Terraform: production infrastructure of my own",
      },
      { label: "Something else", hint: "say it below" },
    ],
  },
];

/** How many questions this fixture can write, so a caller asking for more is told. */
export const howManyQuestions = theQuestions.length;

/**
 * A person with the questions a reading would have left them, written directly.
 *
 * `count` is how many of them, in the order they are asked; the default is all four. The
 * ids come back for a case that acts on a question without reading the profile first.
 */
export const withQuestions = async (
  userId: string,
  count: number = howManyQuestions,
): Promise<{ questionIds: string[]; optionIds: string[] }> => {
  if (count > howManyQuestions) {
    throw new Error(
      `the fixture holds ${howManyQuestions} questions and ${count} were asked for; add the one you need to tests/support/questions.ts`,
    );
  }

  // The person's questions are this fixture's: the options go with them through the
  // foreign key's cascade.
  await testDb.delete(question).where(eq(question.userId, userId));

  const documents = await testDb
    .select({ id: document.id })
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(asc(document.createdAt), asc(document.id));

  const standing = await testDb
    .select()
    .from(profileItem)
    .where(eq(profileItem.userId, userId))
    .orderBy(asc(profileItem.position), asc(profileItem.id));
  const idOf = new Map<string, string>();
  for (const item of standing) if (!idOf.has(item.title)) idOf.set(item.title, item.id);
  let position = standing.length;

  /** The item a title names, written with its documents behind it when there is none. */
  const itemFor = async (
    kind: ItemKind,
    title: string,
    parentId: string | null,
  ): Promise<string> => {
    const already = idOf.get(title);
    if (already !== undefined) return already;
    const id = randomUUID();
    await testDb
      .insert(profileItem)
      .values({ id, userId, kind, parentId, title, position: position++ });
    if (kind === "entry") await testDb.insert(itemEntry).values({ itemId: id, label: title });
    if (kind === "experience") {
      await testDb.insert(itemExperience).values({ itemId: id, organisation: "HEIG-VD" });
    }
    // Cited by every document the person handed over, so the profile counts them and the
    // assistant has something to open on.
    for (const each of documents) {
      await testDb
        .insert(provenance)
        .values({ id: randomUUID(), documentId: each.id, itemId: id, said: title });
    }
    idOf.set(title, id);
    return id;
  };

  const questionIds: string[] = [];
  const optionIds: string[] = [];
  for (const [at, asked] of theQuestions.slice(0, count).entries()) {
    const parentId =
      asked.item.under === undefined ? null : await itemFor("group", asked.item.under, null);
    const itemId = await itemFor(asked.item.kind, asked.item.title, parentId);
    const id = randomUUID();
    await testDb.insert(question).values({
      id,
      userId,
      itemId,
      kind: asked.kind,
      asked: true,
      where: asked.where,
      lead: asked.lead,
      state: "waiting",
      position: at,
    });
    questionIds.push(id);
    for (const [position, option] of asked.options.entries()) {
      const optionId = randomUUID();
      await testDb.insert(questionOption).values({
        id: optionId,
        questionId: id,
        position,
        label: option.label,
        hint: option.hint,
        // The last row is always the person's own words, and carries no concern, as the
        // run writes it.
        concern: position === asked.options.length - 1 ? null : (option.concern ?? null),
      });
      optionIds.push(optionId);
    }
  }
  return { questionIds, optionIds };
};
