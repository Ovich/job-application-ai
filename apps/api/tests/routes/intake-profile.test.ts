import { beforeEach, describe, expect, it, vi } from "vitest";
import { subjectAt } from "../support/providers";

/**
 * Seam A: `routes/intake`, `GET /profile` (criteria 2, 6, 8).
 *
 * Behind the seam: PostgreSQL itself, in this process on PGlite, migrated from the
 * project's own migration files — so the item kind enum of criterion 1 is really enforced
 * here. A person and their profile are planted through `tests/support/profile.ts` and
 * everything asserted comes back through the route.
 *
 * **Criterion 9, "nothing inferred", was read here and no longer can be** (`ID334`). It
 * was checked by looking for a figure in a row's own words that none of the documents
 * behind that row quoted, and no row keeps what a document said any more. Its two cases
 * are retired with the field they read; what the reading may state is the reader's own
 * instruction, held in `intake-read`.
 *
 * Not past it: the rows themselves. What was written is read back through this route,
 * because the route that writes a profile is the route that reads it (the plan's *How
 * this project tests*). No test here selects from `profile_item`.
 */

vi.mock("../../src/lib/db", async () => ({
  db: (await import("../support/database")).testDb,
}));

const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { plantProfile } = await import("../support/profile");

const signedIn = async (email: string) => {
  const response = await signInThrough("google", {
    subject: subjectAt("google", email),
    name: "Someone Seeking",
    email,
    emailVerified: true,
  });
  const user = await signedInAs(response);
  if (user === null) throw new Error(`the sign-in for ${email} produced no session`);
  vi.unstubAllGlobals();
  return { id: user.id, cookie: cookiesSetBy(response) };
};

/** One item, as the route answers it. Declared here so a case reads as its claim. */
type Answered = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  startText: string | null;
  endText: string | null;
  experience: Record<string, string | null> | null;
  project: Record<string, string | null> | null;
  education: Record<string, string | null> | null;
  entry: Record<string, string | null> | null;
  lines: { id: string; text: string }[];
  children: Answered[];
};

type Profile = {
  name: string | null;
  readOn: string | null;
  summary: Answered | null;
  identity: Answered | null;
  experience: Answered[];
  projects: Answered[];
  groups: Answered[];
  education: Answered[];
};

const profileOf = async (cookie: string): Promise<Profile> => {
  const answer = await app.request("/api/intake/profile", { headers: { cookie } });
  expect(answer.status).toBe(200);
  return (await answer.json()) as Profile;
};

/** Every item of an answer, at every depth, so a claim about "any row" can be made. */
const everyItem = (profile: Profile): Answered[] => {
  const found: Answered[] = [];
  const walk = (items: (Answered | null)[]) => {
    for (const item of items) {
      if (item === null) continue;
      found.push(item);
      walk(item.children);
    }
  };
  walk([
    profile.summary,
    profile.identity,
    ...profile.experience,
    ...profile.projects,
    ...profile.groups,
    ...profile.education,
  ]);
  return found;
};

/** The twelve groups of the mockup, in its order, each with entries of its own. */
const twelveGroups = [
  "Domains",
  "Programming languages",
  "Frameworks and libraries",
  "Software design and architecture",
  "Blockchain",
  "Databases",
  "Platforms and infrastructure",
  "DevOps and cloud",
  "AI and machine learning",
  "Tools",
  "Ways of working",
  "Practice",
];

const aProfile = async (userId: string) => {
  await plantProfile(userId, {
    documents: ["2026-08-30_cv_FR.pdf", "2026-08-30_cv_EN.pdf"],
    items: [
      {
        kind: "summary",
        title: "Software Engineer & IT Project Manager",
      },
      {
        kind: "identity",
        title: "Stefan Teofanovic",
        subtitle: "Montreux, Switzerland",
      },
      {
        kind: "experience",
        title: "R&D Collaborator in Software Engineering",
        startText: "Aug 2022",
        endText: "Aug 2026",
        experience: {
          organisation: "HEIG-VD",
          location: "Yverdon-les-Bains, Switzerland",
          arrangement: "Hybrid",
        },
        lines: [
          {
            text: "Academic Assistant for TWEB, PRG1 and DOP courses.",
          },
          {
            text: "Responsible for practical lab support on the DevOps course.",
          },
          {
            text: "Design and maintenance of educational platforms.",
          },
        ],
        children: [
          {
            kind: "project",
            title: "Opendidac",
            project: {
              description: "An educational platform for exercises and exams.",
              datesText: "since 2022",
            },
          },
        ],
      },
      {
        kind: "project",
        title: "Autonomous-Trader",
        project: { description: "An autonomous paper-trading loop.", datesText: "Feb - Dec 2024" },
      },
      ...twelveGroups.map((title, at) => ({
        kind: "group" as const,
        title,
        children: [
          {
            kind: "entry" as const,
            title: `${title} thing one`,
            entry: { label: `${title} thing one` },
          },
          {
            kind: "entry" as const,
            title: `${title} thing two`,
            entry: { label: `${title} thing two` },
          },
        ].slice(0, at === 0 ? 1 : 2),
      })),
      {
        kind: "education",
        title: "Bachelor of Applied Science (BASc), Software Engineering",
        startText: "2018",
        endText: "2022",
        education: { institution: "HEIG-VD", location: "Yverdon-les-Bains, Switzerland" },
      },
      {
        kind: "publication",
        title: "Designing a Data-Driven Survey System",
        subtitle: "ACM CHI 2024",
      },
      {
        kind: "language",
        title: "French, English, Serbian",
      },
    ],
  });
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the profile, read back whole (criterion 2)", () => {
  it("answers an experience with its lines in order and its project under it", async () => {
    const person = await signedIn("profile-read-back@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);
    const [post] = profile.experience;

    expect(post?.title).toBe("R&D Collaborator in Software Engineering");
    expect(post?.experience?.["organisation"]).toBe("HEIG-VD");
    expect(post?.lines.map((line) => line.text)).toEqual([
      "Academic Assistant for TWEB, PRG1 and DOP courses.",
      "Responsible for practical lab support on the DevOps course.",
      "Design and maintenance of educational platforms.",
    ]);
    expect(post?.children.map((child) => [child.kind, child.title])).toEqual([
      ["project", "Opendidac"],
    ]);
  });

  it("keeps a personal project out of the posts and under its own name", async () => {
    const person = await signedIn("personal-project@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);

    expect(profile.projects.map((each) => each.title)).toEqual(["Autonomous-Trader"]);
    expect(profile.experience).toHaveLength(1);
  });

  it("answers the diplomas, the publication and the languages as rows of their own", async () => {
    const person = await signedIn("education-publication-languages@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);

    expect(profile.education.map((each) => each.kind)).toEqual([
      "education",
      "publication",
      "language",
    ]);
  });
});

describe("the groups are flat (criterion 8, D17)", () => {
  it("answers twelve groups in order, each one entries and nothing under them", async () => {
    const person = await signedIn("twelve-flat-groups@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);

    expect(profile.groups.map((group) => group.title)).toEqual(twelveGroups);
    for (const group of profile.groups) {
      expect(group.children.map((entry) => entry.kind)).toEqual(group.children.map(() => "entry"));
      expect(group.children.flatMap((entry) => entry.children)).toEqual([]);
    }
    // 23 chips: eleven groups of two and the first one of one, and every one answered.
    expect(profile.groups.flatMap((group) => group.children)).toHaveLength(23);
  });
});

describe("one person's profile and nobody else's (criterion 6, ID118)", () => {
  it("answers this person's items and none of another person's", async () => {
    const mine = await signedIn("mine-alone@example.com");
    const theirs = await signedIn("theirs-alone@example.com");
    await aProfile(mine.id);
    await plantProfile(theirs.id, {
      documents: ["CV-2025.pdf"],
      items: [
        {
          kind: "experience",
          title: "Somebody else's post",
          experience: { organisation: "Elsewhere" },
        },
      ],
    });

    const profile = await profileOf(mine.cookie);

    expect(everyItem(profile).map((item) => item.title)).not.toContain("Somebody else's post");
    expect(profile.experience.map((each) => each.title)).toEqual([
      "R&D Collaborator in Software Engineering",
    ]);
  });

  it("turns away a browser with no session at all", async () => {
    expect((await app.request("/api/intake/profile")).status).toBe(401);
  });
});

describe("a person with nothing read yet (criterion 8, the empty branch)", () => {
  it("answers an empty profile rather than a 404", async () => {
    const person = await signedIn("nothing-read-yet@example.com");

    const answer = await app.request("/api/intake/profile", {
      headers: { cookie: person.cookie },
    });

    expect(answer.status).toBe(200);
    const profile = (await answer.json()) as Profile;
    expect(profile.summary).toBeNull();
    expect(profile.identity).toBeNull();
    expect([
      ...profile.experience,
      ...profile.projects,
      ...profile.groups,
      ...profile.education,
    ]).toEqual([]);
  });
});

describe("where a fact came from is not on this wire (`ID334`)", () => {
  /** Every key of an item and of its lines, at every depth, as JSON carries them. */
  const keysOf = (profile: Profile): string[] => {
    const keys = new Set<string>();
    for (const item of everyItem(profile)) {
      for (const key of Object.keys(item)) keys.add(key);
      for (const line of item.lines) for (const key of Object.keys(line)) keys.add(`lines.${key}`);
    }
    return [...keys];
  };

  it("carries no sources on an item or on a line", async () => {
    const person = await signedIn("no-sources-on-the-wire@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);

    // The profile is read whole first, so an empty answer cannot make this claim pass.
    expect(everyItem(profile).length).toBeGreaterThan(20);
    expect(profile.experience[0]?.lines.length).toBeGreaterThan(0);
    expect(keysOf(profile)).not.toContain("sources");
    expect(keysOf(profile)).not.toContain("lines.sources");
  });

  it("carries no document count beside the profile, an item or a line", async () => {
    const person = await signedIn("no-document-count@example.com");
    await aProfile(person.id);

    const profile = await profileOf(person.cookie);

    expect(Object.keys(profile)).not.toContain("documents");
    expect(keysOf(profile)).not.toContain("documents");
    expect(keysOf(profile)).not.toContain("lines.documents");
  });
});
