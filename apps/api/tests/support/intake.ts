/**
 * The suite's own intake support for the questions and the rules (ID129, on SL1's,
 * SL2's and SL3's precedent).
 *
 * It hides one thing and no behaviour: the profile as `GET /api/intake/profile` answers
 * it, and finding an item or a question in it by the name a case knows it under.
 *
 * **It reads nothing with a query of its own.** A question, a rule and a count all come
 * back through the route, so a test here breaks when behaviour changes and not when a
 * column is renamed. That is the seam the slice document draws, and this module is what
 * keeps a case from reaching past it.
 *
 * **It states no reading's answer any more** (`S3.1`). It held a fixture that wrote a
 * run's one case out of a profile and the candidates it proposed, for the suite about the
 * questions a reading left open. A reading leaves none (`ID333`), that suite is retired,
 * and the cases of it that outlived their subject were moved into `intake-read`, which
 * states its own cases as every other reading case there does.
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
  options: { id: string; label: string; hint: string; concern: string | null }[];
};

/** One profile concern as `GET /profile` answers it, against the item it was kept on (D14). */
export type ItemConcern = { id: string; text: string; source: string; createdAt: string };

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
  concern: ItemConcern | null;
  concerns: ItemConcern[];
  question: AskedQuestion | null;
  /** The bullets under a post, each with its own id, which a rule may be about. */
  lines: { id: string; text: string }[];
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
