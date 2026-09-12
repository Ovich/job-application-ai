import type { RecordedCaseFile } from "../../src/lib/ai/mock";
import type { CaseName } from "../../src/lib/ai/types";

/**
 * The suite's own intake support for the questions and the rules (ID129, on SL1's,
 * SL2's and SL3's precedent).
 *
 * It hides three things and no behaviour: driving a reading run over named documents
 * through the routes SL2 and SL3 built, pointing the AI at a named set of fixture cases
 * so a test can state what the reader answered without writing a file into the
 * product's tree, and reading every answer back through `GET /api/intake/profile`.
 *
 * **It reads nothing with a query of its own.** A question, a rule and a count all come
 * back through the route, so a test here breaks when behaviour changes and not when a
 * column is renamed. That is the seam the slice document draws, and this module is what
 * keeps a case from reaching past it.
 *
 * **There is no run id.** The module block of the slice names `aRunWith` returning one,
 * and this schema has no `read_run` table to give it: a reading run keeps nothing of its
 * own between its steps (`ID139`, open, the person's). A run is therefore identified by
 * the person whose documents it read, which is what every route here filters by anyway.
 */

/** One question as `GET /profile` answers it. Fewer fields than the table, on purpose. */
export type AskedQuestion = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: string;
  where: string;
  lead: string;
  state: string;
  options: { id: string; label: string; hint: string; rule: string | null }[];
};

/** One rule as `GET /profile` answers it, against the item it was written on. */
export type ItemRule = { id: string; text: string; source: string; createdAt: string };

/** As much of the profile's answer as a case about questions and rules reads. */
export type ProfileAnswer = {
  questions: AskedQuestion[];
  notAsked: number;
  experience: ProfileItem[];
  projects: ProfileItem[];
  groups: ProfileItem[];
  education: ProfileItem[];
  summary: ProfileItem | null;
  identity: ProfileItem | null;
};

export type ProfileItem = {
  id: string;
  kind: string;
  title: string;
  rule: ItemRule | null;
  rules: ItemRule[];
  question: AskedQuestion | null;
  children: ProfileItem[];
};

/** Every item of a profile, the nesting flattened, so a case can find one by its title. */
export const everyItem = (profile: ProfileAnswer): ProfileItem[] => {
  const all: ProfileItem[] = [];
  const walk = (items: ProfileItem[]): void => {
    for (const item of items) {
      all.push(item);
      walk(item.children);
    }
  };
  walk([
    ...(profile.summary === null ? [] : [profile.summary]),
    ...(profile.identity === null ? [] : [profile.identity]),
    ...profile.experience,
    ...profile.projects,
    ...profile.groups,
    ...profile.education,
  ]);
  return all;
};

/** The item a case names, by the title the merge gave it. */
export const itemNamed = (profile: ProfileAnswer, title: string): ProfileItem => {
  const found = everyItem(profile).find((item) => item.title === title);
  if (found === undefined) {
    throw new Error(
      `the profile has no item called ${title}; it has ${
        everyItem(profile)
          .map((item) => item.title)
          .join(", ") || "nothing"
      }`,
    );
  }
  return found;
};

/**
 * What a run's cases are, stated as a test states them: what each document's reading
 * said, what the merge produced, and what the reader found it could not tell.
 *
 * The classification and the extraction of each document are filled in here, because no
 * case in this slice is about either: what they are is the merge's own input, and a test
 * that spelled six of them out would bury the one answer it is actually about.
 */
export type RunCases = {
  documents: readonly string[];
  merge: unknown;
  /** Left out when the case is about a run whose fourth step is never reached. */
  questions?: unknown;
  /** Written in place of the questions case, for a case about a malformed answer. */
  questionsRaw?: string;
};

/** A document's slug: its filename without the extension, as the handlers compose one. */
const slugOf = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? filename : filename.slice(0, dot);
};

const recorded = (stands_for: string, content: string): Omit<RecordedCaseFile, "case"> => ({
  stands_for,
  content,
});

/**
 * The cases one run needs, in the shape `withCases` takes.
 *
 * A case recorded here still stands for a real file: the documents are named by the
 * person's own, and what the merge and the fourth step say is what a reader should get
 * out of them (`D20`). What this function invents is nothing — it fills in the two
 * steps whose content no case here asserts.
 */
export const casesForRun = (run: RunCases): Record<CaseName, Omit<RecordedCaseFile, "case">> => {
  const slugs = run.documents.map(slugOf);
  const cases: Record<string, Omit<RecordedCaseFile, "case">> = {};
  for (const [at, slug] of slugs.entries()) {
    cases[`intake.classify:${slug}`] = recorded(
      `${run.documents[at]}, classified. No case in this slice is about the classification.`,
      JSON.stringify({ kind: "cv", language: "en", confidence: 1, why: `${slug} is a CV.` }),
    );
    cases[`intake.extract:${slug}`] = recorded(
      `${run.documents[at]}, read for what it states. Its facts are the merge's input and nothing here asserts them.`,
      JSON.stringify({
        facts: [{ kind: "experience", title: slug, said: `${slug} states a post.`, lines: [] }],
      }),
    );
  }
  cases[`intake.merge:${slugs.join("+")}`] = recorded(
    "the readings of this run, reconciled into the profile the fourth step is then asked about.",
    JSON.stringify(run.merge),
  );
  if (run.questionsRaw !== undefined) {
    cases[`intake.questions:${slugs.join("+")}`] = recorded(
      "an answer the fourth step cannot use: the step fails and no question is written.",
      run.questionsRaw,
    );
  } else if (run.questions !== undefined) {
    cases[`intake.questions:${slugs.join("+")}`] = recorded(
      "what the reader found it could not tell from this run's documents.",
      JSON.stringify(run.questions),
    );
  }
  return cases as Record<CaseName, Omit<RecordedCaseFile, "case">>;
};

/**
 * One item as a merge states it, so a case says what a profile is in one line rather
 * than in the merge's whole shape. `from` is the documents that stated it, by slug.
 */
export type MergedItem = {
  kind: string;
  title: string;
  from: { document: string; said: string }[];
  children?: MergedItem[];
  entry?: { label: string };
};

/** A merged profile from items stated the short way above. */
export const aProfileOf = (items: MergedItem[]): unknown => {
  const asMerged = (item: MergedItem): unknown => ({
    kind: item.kind,
    title: item.title,
    ...(item.kind === "entry" ? { entry: item.entry ?? { label: item.title } } : {}),
    lines: [],
    children: (item.children ?? []).map(asMerged),
    sources: item.from,
  });
  return { items: items.map(asMerged) };
};
