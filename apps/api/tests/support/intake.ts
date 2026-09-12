import type { RecordedCaseFile } from "../../src/lib/mock";

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

/** The item a case names, by the title the reading gave it. */
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
 * What a run's case is, stated as a test states them: the profile the reading answers
 * with, and the questions it says those documents leave open.
 *
 * **One run is one case now** (`ID157`, `ID158`). There is no classification, no
 * extraction per document and no merge to fill in, so nothing is filled in: what a test
 * states here is the whole of what the reader answered, and the two halves are written
 * apart only because a test is about one of them at a time.
 */
export type RunCases = {
  documents: readonly string[];
  /**
   * What the reading says the profile is. Left out when the case is about a run for
   * which nothing was recorded at all — then no case is written, and the reading misses.
   */
  profile?: { items: unknown[] };
  /** What the reading says those documents leave open. Left out means: nothing. */
  questions?: { candidates: unknown[] };
  /** Written in place of both halves, for a case about an answer the run cannot use. */
  raw?: string;
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

/** The one case a run asks for, named by every document of the run, in the run's order. */
export const caseNameFor = (documents: readonly string[]): string =>
  `intake.read:${documents.map(slugOf).join("+")}`;

/**
 * The one case a run needs, in the shape `withCases` takes.
 *
 * A case recorded here still stands for real files: the documents are named by the
 * person's own, and what the reading says is what a reader should get out of them
 * (`D20`). What this function invents is nothing — it joins the two halves a test wrote
 * apart into the single answer the one call gives.
 */
export const casesForRun = (run: RunCases): Record<string, Omit<RecordedCaseFile, "case">> => {
  const name = caseNameFor(run.documents);
  if (run.raw !== undefined) {
    return {
      [name]: recorded(
        "an answer this run cannot use: the reading fails, and with it every document of the run.",
        run.raw,
      ),
    };
  }
  // No profile stated is no case at all: the reading misses, which is what a run whose
  // answer nobody recorded looks like from here (`ID113`).
  if (run.profile === undefined) return {};
  return {
    [name]: recorded(
      `${run.documents.join(", ")} read whole, in one call: the profile and the questions those documents leave open.`,
      JSON.stringify({ items: run.profile.items, candidates: run.questions?.candidates ?? [] }),
    ),
  };
};

/**
 * One item as the reading states it, so a case says what a profile is in one line
 * rather than in the answer's whole shape. `from` is the parts that stated it, by slug.
 */
export type MergedItem = {
  kind: string;
  title: string;
  from: { document: string; said: string }[];
  children?: MergedItem[];
  entry?: { label: string };
};

/** The profile half of a reading's answer, from items stated the short way above. */
export const aProfileOf = (items: MergedItem[]): { items: unknown[] } => {
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
