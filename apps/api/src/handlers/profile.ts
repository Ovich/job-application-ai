import {
  document,
  type ItemKind,
  itemEducation,
  itemEntry,
  itemExperience,
  itemLine,
  itemProject,
  type ProfileConcernKind,
  type ProfileConcernSource,
  type ProfileItem,
  profileConcern,
  profileItem,
  provenance,
  type QuestionKind,
  type QuestionState,
  question,
  questionOption,
} from "@app/db";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { createFactory } from "hono/factory";
import { db } from "../lib/db";
import { asking, refused } from "../lib/session";

const factory = createFactory();

/**
 * The profile a person reads back (`ID118`'s `GET /profile`, criteria 2, 6, 8, 9).
 *
 * **One payload, deliberately not paged** (`F4`). Exhaustiveness is the screen's whole
 * contract, so a page size would be the first fold, and a real profile is a few hundred
 * rows. What comes back is the rows as the tables hold them, reshaped by nothing: the
 * spine's columns, the per-kind block for the item's own kind, its lines, its children,
 * and what each document said about it, verbatim.
 *
 * **Every count here is a count of rows.** `documents` beside an item is
 * `count(distinct document_id)` over that item's provenance, which is what makes
 * "4 documents" a fact about the database rather than a number somebody stored (`F3`).
 * Nothing is derived from a date and no arithmetic is done anywhere below.
 *
 * Filtered by the session's user like every route here, and a person with nothing read
 * is answered an empty profile rather than a 404: having no profile yet is not the same
 * thing as there being no such address (spec, *Failure modes*).
 */

/** What one document said about one fact, and which document said it. */
type Source = { document: string; said: string };

/**
 * One profile concern on the wire. `supersededBy` is carried, not hidden, because what
 * `ID121` exists to keep is the history: a screen shows the current concern, and the
 * earlier words are still readable beside it.
 */
export type ProfileConcernAnswer = {
  id: string;
  text: string;
  kind: ProfileConcernKind;
  source: ProfileConcernSource;
  createdAt: string;
  supersededBy: string | null;
};

/** One question on the wire, with the item it is about and the rows it offers. */
export type QuestionAnswer = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: QuestionKind;
  where: string;
  lead: string;
  state: QuestionState;
  options: { id: string; label: string; hint: string; concern: string | null }[];
};

/** One item on the wire: the spine, the per-kind block, its lines and what hangs under it. */
export type ProfileItemAnswer = {
  id: string;
  kind: ItemKind;
  title: string;
  subtitle: string | null;
  startText: string | null;
  endText: string | null;
  documents: number;
  experience: {
    organisation: string;
    organisationNote: string | null;
    location: string | null;
    arrangement: string | null;
  } | null;
  project: { description: string; datesText: string | null } | null;
  education: {
    institution: string;
    location: string | null;
    credential: string | null;
    note: string | null;
  } | null;
  entry: { label: string; qualifier: string | null } | null;
  lines: { id: string; text: string; documents: number; sources: Source[] }[];
  children: ProfileItemAnswer[];
  sources: Source[];
  /** What the person said about this item, newest first. Nothing is ever removed. */
  concerns: ProfileConcernAnswer[];
  /** The one concern nothing has superseded: what the builder reads before writing. */
  concern: ProfileConcernAnswer | null;
  /** The question this intake asked about it, whatever state it is now in. */
  question: QuestionAnswer | null;
};

/** The whole profile, in the panels the sheet draws, so the sheet composes nothing. */
export type ProfileAnswer = {
  name: string | null;
  documents: number;
  readOn: string | null;
  summary: ProfileItemAnswer | null;
  identity: ProfileItemAnswer | null;
  experience: ProfileItemAnswer[];
  projects: ProfileItemAnswer[];
  groups: ProfileItemAnswer[];
  education: ProfileItemAnswer[];
  /** The questions this intake asked, in the order they are asked. At most five. */
  questions: QuestionAnswer[];
  /** How many more were written against their items and deferred to the builder (`D19`). */
  notAsked: number;
};

/** An empty profile: a person who has read nothing yet, and not an error. */
const noProfileYet: ProfileAnswer = {
  name: null,
  documents: 0,
  readOn: null,
  summary: null,
  identity: null,
  experience: [],
  projects: [],
  groups: [],
  education: [],
  questions: [],
  notAsked: 0,
};

/** The whole of one person's profile, assembled from the rows. */
export const profileOf = async (userId: string): Promise<ProfileAnswer> => {
  const items = await db
    .select()
    .from(profileItem)
    .where(eq(profileItem.userId, userId))
    .orderBy(asc(profileItem.position), asc(profileItem.id));
  if (items.length === 0) return noProfileYet;

  const ids = items.map((item) => item.id);
  const [experiences, projects, educations, entries, lines, quotes, questions, options, concerns] =
    await Promise.all([
      db.select().from(itemExperience).where(inArray(itemExperience.itemId, ids)),
      db.select().from(itemProject).where(inArray(itemProject.itemId, ids)),
      db.select().from(itemEducation).where(inArray(itemEducation.itemId, ids)),
      db.select().from(itemEntry).where(inArray(itemEntry.itemId, ids)),
      db
        .select()
        .from(itemLine)
        .where(inArray(itemLine.itemId, ids))
        .orderBy(asc(itemLine.position), asc(itemLine.id)),
      // The documents in the order the person handed them over, so two documents that
      // said the same thing are quoted in a stable order and never in the order a hash
      // happened to produce.
      db
        .select({
          itemId: provenance.itemId,
          lineId: provenance.lineId,
          said: provenance.said,
          filename: document.filename,
          readAt: document.readAt,
          documentId: document.id,
        })
        .from(provenance)
        .innerJoin(document, eq(provenance.documentId, document.id))
        .where(eq(document.userId, userId))
        .orderBy(asc(document.createdAt), asc(document.id), asc(provenance.id)),
      // The questions in the order they are asked, and the concerns newest first, so the
      // current one is the head of the list as well as the row nothing has superseded.
      db
        .select()
        .from(question)
        .where(eq(question.userId, userId))
        .orderBy(asc(question.position), asc(question.id)),
      db
        .select({
          id: questionOption.id,
          questionId: questionOption.questionId,
          label: questionOption.label,
          hint: questionOption.hint,
          concern: questionOption.concern,
        })
        .from(questionOption)
        .innerJoin(question, eq(questionOption.questionId, question.id))
        .where(eq(question.userId, userId))
        .orderBy(asc(questionOption.position), asc(questionOption.id)),
      db
        .select()
        .from(profileConcern)
        .where(eq(profileConcern.userId, userId))
        .orderBy(desc(profileConcern.createdAt), desc(profileConcern.id)),
    ]);

  const by = <T extends { itemId: string }>(rows: T[]): Map<string, T> =>
    new Map(rows.map((row) => [row.itemId, row]));
  const experienceOf = by(experiences);
  const projectOf = by(projects);
  const educationOf = by(educations);
  const entryOf = by(entries);

  /** What each item and each line was told, by which document, and by how many. */
  const saidOf = { item: new Map<string, Source[]>(), line: new Map<string, Source[]>() };
  const countOf = { item: new Map<string, Set<string>>(), line: new Map<string, Set<string>>() };
  const documentsUsed = new Set<string>();
  let readOn: Date | null = null;
  for (const quote of quotes) {
    const against = quote.itemId === null ? "line" : "item";
    const key = quote.itemId ?? quote.lineId ?? "";
    saidOf[against].set(key, [
      ...(saidOf[against].get(key) ?? []),
      { document: quote.filename, said: quote.said },
    ]);
    countOf[against].set(key, (countOf[against].get(key) ?? new Set()).add(quote.documentId));
    documentsUsed.add(quote.documentId);
    if (quote.readAt !== null && (readOn === null || quote.readAt > readOn)) readOn = quote.readAt;
  }

  const linesOf = new Map<string, ProfileItemAnswer["lines"]>();
  for (const line of lines) {
    linesOf.set(line.itemId, [
      ...(linesOf.get(line.itemId) ?? []),
      {
        id: line.id,
        text: line.text,
        documents: countOf.line.get(line.id)?.size ?? 0,
        sources: saidOf.line.get(line.id) ?? [],
      },
    ]);
  }

  /** What each question offers, and which item each question and each concern is about. */
  const titleOf = new Map(items.map((item) => [item.id, item.title]));
  const optionsOf = new Map<string, QuestionAnswer["options"]>();
  for (const option of options) {
    optionsOf.set(option.questionId, [
      ...(optionsOf.get(option.questionId) ?? []),
      { id: option.id, label: option.label, hint: option.hint, concern: option.concern },
    ]);
  }
  const asQuestion = (row: (typeof questions)[number]): QuestionAnswer => ({
    id: row.id,
    itemId: row.itemId,
    itemTitle: titleOf.get(row.itemId) ?? "",
    kind: row.kind,
    where: row.where,
    lead: row.lead,
    state: row.state,
    options: optionsOf.get(row.id) ?? [],
  });
  const questionOf = new Map<string, QuestionAnswer>();
  for (const row of questions) {
    if (row.asked && !questionOf.has(row.itemId)) questionOf.set(row.itemId, asQuestion(row));
  }

  const concernsOf = new Map<string, ProfileConcernAnswer[]>();
  for (const row of concerns) {
    concernsOf.set(row.itemId, [
      ...(concernsOf.get(row.itemId) ?? []),
      {
        id: row.id,
        text: row.text,
        kind: row.kind,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
        supersededBy: row.supersededBy,
      },
    ]);
  }

  const asAnswer = (item: ProfileItem): ProfileItemAnswer => {
    const experience = experienceOf.get(item.id);
    const project = projectOf.get(item.id);
    const education = educationOf.get(item.id);
    const entry = entryOf.get(item.id);
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      startText: item.startText,
      endText: item.endText,
      documents: countOf.item.get(item.id)?.size ?? 0,
      experience:
        experience === undefined
          ? null
          : {
              organisation: experience.organisation,
              organisationNote: experience.organisationNote,
              location: experience.location,
              arrangement: experience.arrangement,
            },
      project:
        project === undefined
          ? null
          : { description: project.description, datesText: project.datesText },
      education:
        education === undefined
          ? null
          : {
              institution: education.institution,
              location: education.location,
              credential: education.credential,
              note: education.note,
            },
      entry: entry === undefined ? null : { label: entry.label, qualifier: entry.qualifier },
      lines: linesOf.get(item.id) ?? [],
      children: items.filter((each) => each.parentId === item.id).map(asAnswer),
      sources: saidOf.item.get(item.id) ?? [],
      concerns: concernsOf.get(item.id) ?? [],
      // The item's current concern is the one row nothing has superseded, which is a fact
      // about the rows rather than the newest of them (`ID121`).
      concern: (concernsOf.get(item.id) ?? []).find((each) => each.supersededBy === null) ?? null,
      question: questionOf.get(item.id) ?? null,
    };
  };

  const roots = items.filter((item) => item.parentId === null).map(asAnswer);
  const of = (...kinds: ItemKind[]) => roots.filter((item) => kinds.includes(item.kind));

  return {
    name: of("identity")[0]?.title ?? null,
    documents: documentsUsed.size,
    readOn: readOn === null ? null : readOn.toISOString(),
    summary: of("summary")[0] ?? null,
    identity: of("identity")[0] ?? null,
    experience: of("experience"),
    projects: of("project"),
    groups: of("group"),
    education: of("education", "publication", "language"),
    questions: questions.filter((row) => row.asked).map(asQuestion),
    notAsked: questions.filter((row) => !row.asked).length,
  };
};

/** This person's whole profile, or an empty one. Never anybody else's, and never a 404. */
export const readProfile = factory.createHandlers(async (c) => {
  const person = await asking(c);
  if (person === null) return refused(c);
  return c.json(await profileOf(person.id), 200);
});
