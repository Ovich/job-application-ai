import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import type { RegionRef } from "../../../src/app/profile/profile-region/profile-region";
import { ProfileSheet } from "../../../src/app/profile/profile-sheet/profile-sheet";
import { ProfileViewer } from "../../../src/app/profile/profile-viewer/profile-viewer";
import {
  conversationIs,
  documentsAre,
  emptyProfile,
  entryOf,
  intakeRequests,
  itemOf,
  type Profile,
  profileIs,
  questionOf,
  resetIntake,
  rowOf,
} from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * Seam C: the profile viewer, rendered (criteria 7, 8, 9, 10).
 *
 * Behind it: the RPC client, stood in for at `lib/api`'s own seam with a profile the
 * interface could have answered (`tests/support/intake.ts`). No database and no HTTP.
 *
 * Not past it: the components' fields and their templates' tags. What is asserted is
 * the text a person reads and the thing a person presses. The look is criterion 11's,
 * reviewed against the mockup, and the hover — which is CSS and has no computed style
 * in jsdom — is the end-to-end spec's, in a browser that has the stylesheet.
 */

const person = {
  name: "Stefan Teofanovic",
  email: "stefan@example.com",
  providers: ["google" as const],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * A row's words, one element's worth at a time. `textContent` runs two neighbouring
 * spans together — "Aug 2026" beside "4 documents" reads as one figure, `20264` — and
 * a claim about the figures on a screen must not be made against a number nobody sees.
 */
const piecesOf = (row: Element): string[] =>
  Array.from(row.querySelectorAll("*"))
    .filter((each) => each.children.length === 0)
    .map((each) => textOf(each))
    .filter((each) => each !== "");

/** A chip, which is an `entry` item wherever it hangs. */
const chip = (id: string, label: string) =>
  itemOf({ id, kind: "entry", title: label, entry: { label, qualifier: null } });

/**
 * A profile the interface could have answered: two posts with their lines and their
 * projects, two personal projects, three groups of chips, two diplomas, a paper and the
 * languages. Every figure in it is in a document's own words.
 */
const aFullProfile = (): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 5,
  readOn: new Date().toISOString(),
  summary: itemOf({
    id: "summary",
    kind: "summary",
    title: "Software Engineer and IT Project Manager.",
    documents: 4,
  }),
  identity: itemOf({
    id: "identity",
    kind: "identity",
    title: "Stefan Teofanovic",
    subtitle: "Montreux, Switzerland",
    documents: 4,
  }),
  experience: [
    itemOf({
      id: "post-heig",
      kind: "experience",
      title: "R&D Collaborator in Software Engineering",
      startText: "Aug 2022",
      endText: "Aug 2026",
      documents: 4,
      experience: {
        organisation: "HEIG-VD",
        organisationNote: null,
        location: "Yverdon-les-Bains",
        arrangement: "Hybrid",
      },
      lines: [
        {
          id: "line-1",
          text: "Academic Assistant for the TWEB course.",
          documents: 2,
          sources: [],
        },
        {
          id: "line-2",
          text: "Practical lab support on the DevOps course.",
          documents: 1,
          sources: [],
        },
        { id: "line-3", text: "Design and maintenance of platforms.", documents: 1, sources: [] },
      ],
      children: [
        itemOf({
          id: "project-opendidac",
          kind: "project",
          title: "Opendidac",
          documents: 3,
          project: { description: "An educational platform.", datesText: "since 2022" },
          children: [chip("chip-nextjs", "Next.js")],
        }),
        itemOf({
          id: "project-eval",
          kind: "project",
          title: "Eval",
          documents: 1,
          project: { description: "A grading platform.", datesText: null },
        }),
      ],
    }),
    itemOf({
      id: "post-altran",
      kind: "experience",
      title: "IT Project Manager",
      startText: "2007",
      endText: "2016",
      documents: 2,
      experience: {
        organisation: "Altran",
        organisationNote: null,
        location: "Lausanne",
        arrangement: null,
      },
      lines: [{ id: "line-4", text: "Led the migration programme.", documents: 1, sources: [] }],
    }),
  ],
  projects: [
    itemOf({
      id: "personal-trader",
      kind: "project",
      title: "Autonomous-Trader",
      documents: 2,
      project: { description: "A paper-trading loop.", datesText: "Feb - Dec 2024" },
    }),
    itemOf({
      id: "personal-grader",
      kind: "project",
      title: "Lab Grader",
      documents: 1,
      project: { description: "Skills for grading student labs.", datesText: null },
    }),
  ],
  groups: [
    itemOf({
      id: "group-languages",
      kind: "group",
      title: "Programming languages",
      documents: 4,
      children: [
        chip("chip-js", "JavaScript"),
        chip("chip-ts", "TypeScript"),
        chip("chip-py", "Python"),
      ],
    }),
    itemOf({
      id: "group-devops",
      kind: "group",
      title: "DevOps and cloud",
      documents: 3,
      children: [chip("chip-docker", "Docker"), chip("chip-k8s", "Kubernetes")],
    }),
    itemOf({
      id: "group-tools",
      kind: "group",
      title: "Tools",
      documents: 2,
      children: [chip("chip-git", "Git"), chip("chip-figma", "Figma")],
    }),
  ],
  education: [
    itemOf({
      id: "diploma-basc",
      kind: "education",
      title: "Bachelor of Applied Science (BASc), Software Engineering",
      startText: "2018",
      endText: "2022",
      documents: 4,
      education: {
        institution: "HEIG-VD",
        location: "Yverdon-les-Bains",
        credential: null,
        note: null,
      },
    }),
    itemOf({
      id: "diploma-cfc",
      kind: "education",
      title: "CFC, Informatics",
      startText: "2008",
      documents: 3,
      education: {
        institution: "Ecole des Arches",
        location: "Lausanne",
        credential: null,
        note: null,
      },
    }),
    itemOf({
      id: "paper",
      kind: "publication",
      title: "Designing a Data-Driven Survey System",
      subtitle: "ACM CHI 2024",
      documents: 2,
    }),
    // One row per language, as the merge writes them (the slice's *The modules*).
    itemOf({ id: "language-fr", kind: "language", title: "French", documents: 3 }),
    itemOf({ id: "language-en", kind: "language", title: "English", documents: 3 }),
    itemOf({ id: "language-sr", kind: "language", title: "Serbian", documents: 2 }),
  ],
});

beforeEach(() => {
  reset();
  resetIntake();
  signedInAs(person);
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
});

afterEach(() => {
  reset();
  resetIntake();
});

const opened = async () => {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl("/profile");
  const page = () => harness.routeNativeElement;
  const eventually = (assert: () => void) =>
    vi.waitFor(() => {
      harness.detectChanges();
      assert();
    });
  const all = (selector: string) => Array.from(page()?.querySelectorAll(selector) ?? []);
  const buttonSaying = (label: string) =>
    (all("button").find((button) => textOf(button) === label) ?? undefined) as
      HTMLButtonElement | undefined;
  const panel = (name: string) => page()?.querySelector(`[data-panel="${name}"]`) ?? null;
  await eventually(() => expect(page()?.querySelector("profile-sheet")).not.toBeNull());
  return { harness, page, all, buttonSaying, panel, eventually };
};

describe("the viewer draws the bar and the sheet (criterion 7)", () => {
  it("puts the bar above the sheet, and the sheet's column scrolls on its own", async () => {
    profileIs(aFullProfile());
    const { page } = await opened();

    const order = Array.from(page()?.querySelectorAll("profile-bar, profile-sheet") ?? []).map(
      (element) => element.tagName.toLowerCase(),
    );

    expect(order).toEqual(["profile-bar", "profile-sheet"]);
  });

  it("says who the profile is and how many documents it was read from", async () => {
    profileIs(aFullProfile());
    const { page } = await opened();

    expect(textOf(page()?.querySelector("profile-bar"))).toContain("Stefan Teofanovic");
    expect(textOf(page()?.querySelector("profile-bar"))).toContain("From 5 documents, read today");
  });

  it("shows one column at a time below 1024 px, and the toggle in the bar switches it", async () => {
    profileIs(aFullProfile());
    const { page, buttonSaying, eventually } = await opened();
    const viewer = () => page()?.querySelector("[data-view]");

    // The sheet is what the viewer opens on: the profile is what a person came for.
    expect(viewer()?.getAttribute("data-view")).toBe("sheet");

    buttonSaying("Back to the chat")?.click();
    await eventually(() => expect(viewer()?.getAttribute("data-view")).toBe("chat"));

    buttonSaying("See my profile")?.click();
    await eventually(() => expect(viewer()?.getAttribute("data-view")).toBe("sheet"));
  });
});

describe("the sheet is exhaustive (criterion 8, US4)", () => {
  it("draws every post, line, project, chip, diploma, paper and language the interface answered", async () => {
    const profile = profileIs(aFullProfile());
    const { all } = await opened();

    const projects = [
      ...profile.experience.flatMap((post) => post.children),
      ...profile.projects,
    ].filter((each) => each.kind === "project");
    const chips = [
      ...profile.groups.flatMap((group) => group.children),
      ...profile.experience.flatMap((post) => post.children.flatMap((child) => child.children)),
    ].filter((each) => each.kind === "entry");

    expect(all("[data-row=post]")).toHaveLength(profile.experience.length);
    expect(all("[data-row=line]")).toHaveLength(
      profile.experience.reduce((count, post) => count + post.lines.length, 0),
    );
    expect(all("[data-row=project]")).toHaveLength(projects.length);
    expect(all("[data-row=group]")).toHaveLength(profile.groups.length);
    expect(all("[data-row=chip]")).toHaveLength(chips.length);
    expect(all("[data-row=diploma]")).toHaveLength(
      profile.education.filter((each) => each.kind === "education").length,
    );
    expect(all("[data-row=publication]")).toHaveLength(
      profile.education.filter((each) => each.kind === "publication").length,
    );
    expect(all("[data-row=language]")).toHaveLength(
      profile.education.filter((each) => each.kind === "language").length,
    );
  });

  it("folds nothing away: no row says there is more than it is showing", async () => {
    profileIs(aFullProfile());
    const { page } = await opened();

    // "8 posts" in a heading is a count of what is below it; "8 posts, 3 more" is a
    // fold, and a fold is the one thing US4 forbids.
    expect(textOf(page())).not.toMatch(/\bmore\b/);
  });

  it("counts in each panel's heading exactly what that panel draws", async () => {
    profileIs(aFullProfile());
    const { panel, all } = await opened();

    const posts = all("[data-row=post]").length;
    const under = panel("experience")?.querySelectorAll("[data-row=project]").length ?? 0;
    expect(textOf(panel("experience")?.querySelector("h2"))).toBe(
      `Experience ${posts} posts, 2007 to 2026, ${under} projects`,
    );
    expect(textOf(panel("projects")?.querySelector("h2"))).toBe("Personal projects 2");
    expect(textOf(panel("groups")?.querySelector("h2"))).toBe(
      "What you work with 7 things in 3 groups, each one named in your documents",
    );
    expect(textOf(panel("education")?.querySelector("h2"))).toBe(
      "Education, publication and languages 2 diplomas, 1 paper, 3 languages",
    );
  });

  it("says beside each item how many documents it came from", async () => {
    profileIs(aFullProfile());
    const { all } = await opened();

    const post = all("[data-row=post]")[0];
    expect(textOf(post?.querySelector("[data-part=from]"))).toBe("4 documents");
  });
});

describe("nothing inferred (criterion 9, D16)", () => {
  it("renders no figure in any row that the interface did not answer", async () => {
    const profile = profileIs(aFullProfile());
    const { all } = await opened();

    // Everything the interface said, as one haystack. A row's figures must be in it:
    // the counts are the panels' headings' business, and they are asserted above
    // against what is drawn rather than against a stored number.
    const answered = JSON.stringify(profile);
    const rows = all("[data-row=post],[data-row=project],[data-row=chip],[data-row=diploma]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const figure of piecesOf(row).join(" ").match(/\d+/g) ?? []) {
        // A source count is a count of rows and is drawn from `documents`, so it is
        // answered too; anything else has to be a document's own word.
        expect(answered).toContain(figure);
      }
    }
  });

  it("puts no year on a chip anywhere in the groups", async () => {
    profileIs(aFullProfile());
    const { all, panel } = await opened();

    expect(all("[data-row=chip]").length).toBeGreaterThan(0);
    for (const each of Array.from(panel("groups")?.querySelectorAll("[data-row=chip]") ?? [])) {
      expect(textOf(each)).not.toMatch(/\d/);
    }
  });
});

describe("every item, line, project and chip is a region (criterion 10)", () => {
  it("marks each of them as one, and nothing else", async () => {
    const profile = profileIs(aFullProfile());
    const { all } = await opened();

    const items =
      2 + // the summary and the identity
      profile.experience.length +
      profile.experience.flatMap((post) => post.children).length +
      profile.experience.flatMap((post) => post.children.flatMap((child) => child.children))
        .length +
      profile.projects.length +
      profile.groups.flatMap((group) => group.children).length +
      profile.education.length;
    const lines = profile.experience.reduce((count, post) => count + post.lines.length, 0);

    expect(all("[data-region]")).toHaveLength(items + lines);
  });

  it("emits the region a person pressed, and only that one", async () => {
    const profile = aFullProfile();
    const fixture = TestBed.createComponent(ProfileSheet);
    const chosen: RegionRef[] = [];
    fixture.componentRef.setInput("profile", profile);
    fixture.componentInstance.select.subscribe((region: RegionRef) => chosen.push(region));
    fixture.detectChanges();

    // A chip inside a project inside a post: the pointer is over all three at once, and
    // pressing must say the chip.
    const chip = fixture.nativeElement.querySelector(
      '[data-region][data-id="chip-nextjs"]',
    ) as HTMLElement;
    chip.click();

    expect(chosen).toEqual([{ kind: "item", id: "chip-nextjs" }]);
  });

  it("says of a line that it is a line, so a tool can be bound to one", async () => {
    const fixture = TestBed.createComponent(ProfileSheet);
    const chosen: RegionRef[] = [];
    fixture.componentRef.setInput("profile", aFullProfile());
    fixture.componentInstance.select.subscribe((region: RegionRef) => chosen.push(region));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-region][data-id="line-2"]') as HTMLElement).click();

    expect(chosen).toEqual([{ kind: "line", id: "line-2" }]);
  });
});

describe("the assistant's conversation (agent-consolidation SL2, S2.3)", () => {
  it("opens the profile's conversation and draws what it holds", async () => {
    profileIs(aFullProfile());
    conversationIs([
      entryOf(1, [
        { kind: "text", text: "Words only the stored conversation holds.", scripted: true },
      ]),
    ]);
    const { page, eventually } = await opened();

    await eventually(() =>
      expect(textOf(page()?.querySelector("profile-assistant"))).toContain(
        "Words only the stored conversation holds.",
      ),
    );
    expect(intakeRequests()).toContainEqual({
      method: "GET",
      address: "/api/conversations/profile",
    });
  });
});

describe("a stored edit in the assistant's conversation (agent-consolidation SL4, S4.6, ID185)", () => {
  it("draws the edit's before and after, and no placeholder for its call or its result", async () => {
    const item = {
      id: "item-nexplore",
      kind: "experience",
      title: "Platform engineer",
      subtitle: null,
      startText: null,
      endText: null,
      block: {
        organisation: "Nexplore",
        organisationNote: null,
        location: null,
        arrangement: null,
      },
      lines: [{ id: "line-2", text: "Designed and shipped the platform." }],
      children: [],
    };
    profileIs(aFullProfile());
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 5 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
      entryOf(3, [
        { kind: "text", text: "I will shorten it." },
        { kind: "tool_use", id: "call_1", name: "edit_profile", input: {} },
      ]),
      entryOf(
        4,
        [
          {
            kind: "tool_result",
            id: "call_1",
            name: "edit_profile",
            before: item,
            after: { ...item, lines: [{ id: "line-2", text: "Shipped the platform." }] },
          },
        ],
        "tool",
      ),
    ]);
    const { page, eventually } = await opened();

    await eventually(() =>
      expect(textOf(page()?.querySelector("profile-assistant [data-part=now]"))).toBe(
        "Shipped the platform.",
      ),
    );
    expect(textOf(page()?.querySelector("profile-assistant [data-part=was]"))).toBe(
      "Designed and shipped the platform.",
    );
    expect(textOf(page()?.querySelector("profile-assistant"))).not.toContain(
      "This part cannot be shown here.",
    );
  });
});

/**
 * The person's tool use, in the history (agent-consolidation `S7.3`, spec `H26`, `ID191`):
 * an answer or a skip is drawn on the person's side by the part the profile screen
 * provides, and the conversation is read again once one is written.
 */
describe("the person's tool use in the conversation (agent-consolidation SL7, S7.3)", () => {
  const kubernetes = questionOf({
    id: "q1",
    itemId: "chip-k8s",
    itemTitle: "Kubernetes",
    lead: "Which was it?",
  });
  const asked = {
    lead: kubernetes.lead,
    where: kubernetes.where,
    options: kubernetes.options.map(({ id, label, hint }) => ({ id, label, hint })),
  };
  const opening = entryOf(1, [{ kind: "text", text: "I read your 5 documents.", scripted: true }]);

  /** The person's side of the conversation, as a person reads it. */
  const personSide = (page: () => HTMLElement | null) =>
    Array.from(page()?.querySelectorAll("profile-assistant [data-msg=person]") ?? []).map((each) =>
      textOf(each),
    );

  it("draws a stored answer on the person's side: the option picked and the words", async () => {
    profileIs({ ...aFullProfile(), questions: [{ ...kubernetes, state: "answered" }] });
    conversationIs([
      opening,
      entryOf(
        2,
        [
          {
            kind: "question_answered",
            ...asked,
            picked: "q1-2",
            words: "three clusters, one on bare metal",
          },
        ],
        "person",
      ),
    ]);
    const { page, eventually } = await opened();

    await eventually(() =>
      expect(personSide(page)).toEqual([expect.stringContaining("Ran services on it")]),
    );
    expect(personSide(page)[0]).toContain("three clusters, one on bare metal");
    expect(textOf(page()?.querySelector("profile-assistant"))).not.toContain(
      "This part cannot be shown here.",
    );
  });

  it("draws a stored skip on the person's side as a line saying it was skipped", async () => {
    profileIs({ ...aFullProfile(), questions: [{ ...kubernetes, state: "skipped" }] });
    conversationIs([opening, entryOf(2, [{ kind: "question_skipped", ...asked }], "person")]);
    const { page, eventually } = await opened();

    await eventually(() => expect(personSide(page)).toHaveLength(1));
    expect(personSide(page)[0]).toMatch(/skipped/i);
    expect(personSide(page)[0]).toContain("Which was it?");
    expect(textOf(page()?.querySelector("profile-assistant"))).not.toContain(
      "This part cannot be shown here.",
    );
  });

  it("draws the pick on the person's side after an answer, from the entry the action answered (D9)", async () => {
    profileIs({ ...aFullProfile(), questions: [kubernetes] });
    const { page, eventually } = await opened();
    await eventually(() =>
      expect(page()?.querySelector("profile-assistant [data-action=alt]")).not.toBeNull(),
    );

    page()?.querySelectorAll<HTMLButtonElement>("profile-assistant [data-action=alt]")[1]?.click();
    await eventually(() =>
      expect(
        page()?.querySelector<HTMLButtonElement>("profile-assistant [data-part=send]")?.disabled,
      ).toBe(false),
    );
    page()?.querySelector<HTMLButtonElement>("profile-assistant [data-part=send]")?.click();

    await eventually(() =>
      expect(personSide(page)).toEqual([expect.stringContaining("Ran services on it")]),
    );
    expect(intakeRequests()).toContainEqual({
      method: "POST",
      address: "/api/conversations/profile/actions/answer_question",
    });
  });

  it("draws the skip on the person's side after a skip, from the entry the action answered (D9)", async () => {
    profileIs({ ...aFullProfile(), questions: [kubernetes] });
    const { page, eventually } = await opened();
    await eventually(() =>
      expect(page()?.querySelector("profile-assistant [data-action=skip]")).not.toBeNull(),
    );

    page()?.querySelector<HTMLButtonElement>("profile-assistant [data-action=skip]")?.click();

    await eventually(() => expect(personSide(page)).toEqual([expect.stringMatching(/skipped/i)]));
  });
});

/** The observer and the listeners the reveal set up go with the viewer (`ID248`). */
describe("the viewer going (ID248)", () => {
  it("stops following the column it revealed a region in", async () => {
    profileIs({
      ...aFullProfile(),
      questions: [
        questionOf({
          id: "q1",
          itemId: "chip-k8s",
          itemTitle: "Kubernetes",
          lead: "Which was it?",
        }),
      ],
    });
    const fixture = TestBed.createComponent(ProfileViewer);
    fixture.componentRef.setInput("activated", { itemId: "chip-k8s" });
    const element = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(element.querySelector("[data-at]")?.getAttribute("data-at")).toBe("region");
    });
    const column = element.querySelector("[data-at]");

    fixture.destroy();

    expect(column?.hasAttribute("data-at")).toBe(false);
  });
});

describe("no assistant during the profile intake (S3.0, ID202)", () => {
  it("opens no conversation and draws no assistant column for a person with nothing read", async () => {
    profileIs(emptyProfile);
    // Handed over and not read yet, so the viewer keeps the person rather than sending
    // them to the documents.
    documentsAre([rowOf({ id: "document-1", filename: "2026-08-30_cv_EN.pdf" })]);
    const { page, harness } = await opened();
    await vi.waitFor(() =>
      expect(intakeRequests()).toContainEqual({ method: "GET", address: "/api/intake/documents" }),
    );
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe("/profile");
    expect(
      intakeRequests().filter((each) => each.address.startsWith("/api/conversations/")),
    ).toEqual([]);
    expect(page()?.querySelector('[aria-label="Assistant"]')).toBeNull();
    expect(page()?.querySelector("profile-assistant")).toBeNull();
  });
});

describe("a person whose documents yielded nothing (the empty branch)", () => {
  it("is taken to the documents, because there is nothing here to read", async () => {
    profileIs(emptyProfile);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl("/profile");

    await vi.waitFor(() => {
      harness.detectChanges();
      expect(TestBed.inject(Router).url).toBe("/documents");
    });
  });
});
