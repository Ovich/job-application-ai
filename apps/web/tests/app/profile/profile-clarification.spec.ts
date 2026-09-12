import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import {
  emptyProfile,
  itemOf,
  type Profile,
  profileIs,
  type Question,
  questionOf,
  resetIntake,
} from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * Seam C: the viewer rendered, `ProfileAssistant` with `ProfileSheet` (`SL5`, criteria
 * 1, 2, 3, 4, 5, 7 and 8).
 *
 * Behind it: the intake's client, stood in for at `lib/api`'s own seam with a profile
 * the interface could have answered (`tests/support/intake.ts`). No database and no
 * HTTP.
 *
 * **Criteria 5 and 8 are asked of the column's own `data-at`**, which is what
 * `profile/reveal` writes on it: `region` when a region is being kept in view and `head`
 * when the column was sent back to the top. The offset itself is that module's and has
 * its own file; this slice asserts only which of head-or-stay happened, and jsdom lays
 * nothing out, so a `scrollTop` would read 0 either way and the regression would be
 * invisible.
 */

const person = {
  name: "Stefan Teofanovic",
  email: "stefan@example.com",
  providers: ["google" as const],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const chip = (id: string, label: string, extra: Partial<ReturnType<typeof itemOf>> = {}) =>
  itemOf({ id, kind: "entry", title: label, entry: { label, qualifier: null }, ...extra });

/** A post with a project under it, a chip under that, and a group of two more chips. */
const aProfile = (questions: Question[] = []): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 5,
  readOn: new Date().toISOString(),
  experience: [
    itemOf({
      id: "post-heig",
      kind: "experience",
      title: "R&D Collaborator in Software Engineering",
      experience: {
        organisation: "HEIG-VD",
        organisationNote: null,
        location: "Yverdon-les-Bains",
        arrangement: null,
      },
      children: [
        itemOf({
          id: "project-opendidac",
          kind: "project",
          title: "Opendidac",
          project: { description: "An educational platform.", datesText: "since 2022" },
        }),
      ],
    }),
  ],
  groups: [
    itemOf({
      id: "group-devops",
      kind: "group",
      title: "DevOps and cloud",
      children: [chip("chip-k8s", "Kubernetes"), chip("chip-docker", "Docker")],
    }),
  ],
  questions,
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
  const at = (selector: string) => page()?.querySelector(selector) ?? null;
  const all = (selector: string) => Array.from(page()?.querySelectorAll(selector) ?? []);
  const region = (id: string) => page()?.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? null;
  const press = async (id: string) => {
    region(id)?.click();
    await eventually(() => expect(at("scope-tool")).not.toBeNull());
  };
  const type = async (words: string) => {
    const composer = at("[data-part=composer]") as HTMLInputElement;
    composer.value = words;
    composer.dispatchEvent(new Event("input"));
    harness.detectChanges();
  };
  const saveIt = async () => {
    (at("[data-part=send]") as HTMLButtonElement).click();
    await eventually(() => expect(at("[data-part=send]")).not.toBeNull());
  };
  /** What the scrolling column is following: `region`, or `head` when it was sent back. */
  const columnIsAt = () => page()?.querySelector("[data-at]")?.getAttribute("data-at") ?? null;
  await eventually(() => expect(at("profile-sheet")).not.toBeNull());
  return { harness, page, at, all, region, press, type, saveIt, columnIsAt, eventually };
};

/** The one fixed sentence, verbatim from the mockup. It is a decision, not a suggestion. */
const theSentence = "Tell me what I should know about it, in your own words.";

describe("a click on a region with no question waiting (criteria 1 and 3)", () => {
  it("opens the tool proposing nothing: the sentence, the foot, the composer, and no option", async () => {
    profileIs(aProfile());
    const { at, all, press } = await opened();

    await press("chip-k8s");

    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(theSentence);
    expect(all("[data-action=alt]")).toHaveLength(0);
    expect(at("[data-action=skip]")).toBeNull();
    expect(textOf(at("scope-tool [data-part=foot]"))).toContain(
      "What you write is kept as your rule for it.",
    );
    expect(at("[data-part=composer]")).not.toBeNull();
    expect((at("[data-part=composer]") as HTMLInputElement).placeholder).toBe(
      "Say it in your own words, or click anything in your profile",
    );
  });

  it("says what is in scope in the prefix alone, in the clicked thing's own text", async () => {
    profileIs(aProfile());
    const { at, press } = await opened();

    await press("chip-k8s");

    // The relation alone; what it is about is the tool's to show.
    expect(textOf(at("[data-part=what]"))).toBe("Scope");
    // Nothing else in the assistant's column names it: the prefix is the only place the
    // clicked thing is said, and no sentence is composed about it anywhere.
    const said = textOf(at("profile-assistant")).split("Kubernetes").length - 1;
    expect(said).toBe(1);
  });

  it("closes on Cancel and writes nothing", async () => {
    profileIs(aProfile());
    const { at, press, eventually } = await opened();
    await press("chip-k8s");

    (at("[data-action=cancel]") as HTMLButtonElement).click();

    await eventually(() => expect(at("scope-tool")).toBeNull());
    expect(at("[data-part=rule]")).toBeNull();
  });
});

describe("the same sentence wherever it is opened (criterion 2)", () => {
  it("says the identical text on a chip, on a project and on an experience", async () => {
    profileIs(aProfile());
    const { at, press, eventually } = await opened();
    const said: string[] = [];

    for (const id of ["chip-k8s", "project-opendidac", "post-heig"]) {
      await press(id);
      said.push(textOf(at("scope-tool [data-part=lead]")));
      (at("[data-action=cancel]") as HTMLButtonElement).click();
      await eventually(() => expect(at("scope-tool")).toBeNull());
    }

    expect(said).toEqual([theSentence, theSentence, theSentence]);
  });
});

describe("what the person writes becomes that item's rule (criterion 4)", () => {
  it.each([
    ["chip-k8s", "Kubernetes", "I shipped to a cluster somebody else ran"],
    ["project-opendidac", "Opendidac", "I wrote the back end, never the teaching content"],
    ["post-heig", "R&D Collaborator in Software Engineering", "It was a part-time post"],
  ])("keeps it on %s and shows it as the check line under it", async (id, title, words) => {
    profileIs(aProfile());
    const { region, press, type, saveIt, eventually } = await opened();

    await press(id);
    await type(words);
    await saveIt();

    await eventually(() =>
      expect(textOf(region(id)?.querySelector("[data-part=rule]"))).toBe(`✓ ${title}: ${words}`),
    );
  });
});

describe("where the profile is left (criteria 5 and 8)", () => {
  const oneWaiting = (): Question[] => [
    questionOf({
      id: "q1",
      itemId: "chip-docker",
      itemTitle: "Docker",
      lead: "Did you write the Dockerfiles or run the registry?",
    }),
  ];

  it("returns the assistant to the question still waiting, and does not go to the head", async () => {
    profileIs(aProfile(oneWaiting()));
    const { at, press, type, saveIt, columnIsAt, eventually } = await opened();

    await press("chip-k8s");
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(theSentence);
    await type("I shipped to a cluster somebody else ran");
    await saveIt();

    // The question that was waiting is open again, and the sheet stayed where it was.
    await eventually(() =>
      expect(textOf(at("scope-tool [data-part=lead]"))).toBe(
        "Did you write the Dockerfiles or run the registry?",
      ),
    );
    expect(columnIsAt()).toBe("region");
  });

  it("does not go to the head when a clarification is cancelled either", async () => {
    profileIs(aProfile(oneWaiting()));
    const { at, press, columnIsAt, eventually } = await opened();

    await press("chip-k8s");
    (at("[data-action=cancel]") as HTMLButtonElement).click();
    await eventually(() => expect(at("scope-tool")).not.toBeNull());

    expect(columnIsAt()).toBe("region");
  });

  it("goes to the head when the assistant's last question is answered", async () => {
    profileIs(aProfile(oneWaiting()));
    const { at, all, type, saveIt, columnIsAt, eventually } = await opened();
    await eventually(() => expect(at("scope-tool")).not.toBeNull());

    (all("[data-action=alt]")[0] as HTMLButtonElement).click();
    await type("");
    await saveIt();

    await eventually(() => expect(columnIsAt()).toBe("head"));
  });

  it("goes to the head when the assistant's last question is skipped", async () => {
    profileIs(aProfile(oneWaiting()));
    const { at, columnIsAt, eventually } = await opened();
    await eventually(() => expect(at("scope-tool")).not.toBeNull());

    (at("[data-action=skip]") as HTMLButtonElement).click();

    await eventually(() => expect(columnIsAt()).toBe("head"));
  });
});

describe("a second visit, days later (criterion 7)", () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const aReturn = (): Profile => {
    const already = {
      id: "r1",
      text: "Kubernetes: shipping to a cluster run by others",
      kind: "scope" as const,
      source: "answer" as const,
      createdAt: "2026-09-09T10:14:00.000Z",
      supersededBy: null,
    };
    const profile = aProfile([
      questionOf({
        id: "q0",
        itemId: "chip-k8s",
        itemTitle: "Kubernetes",
        lead: "Which was it?",
        state: "answered",
      }),
      questionOf({
        id: "q1",
        itemId: "chip-docker",
        itemTitle: "Docker",
        lead: "Did you write the Dockerfiles or run the registry?",
      }),
    ]);
    return {
      ...profile,
      readOn: threeDaysAgo,
      groups: [
        itemOf({
          id: "group-devops",
          kind: "group",
          title: "DevOps and cloud",
          children: [
            chip("chip-k8s", "Kubernetes", { rule: already, rules: [already] }),
            chip("chip-docker", "Docker"),
          ],
        }),
      ],
    };
  };

  it("shows the profile, the rule already given, the count as it stands, and the first question still waiting", async () => {
    profileIs(aReturn());
    const { at, page, region } = await opened();

    expect(at("profile-sheet")).not.toBeNull();
    expect(textOf(region("chip-k8s")?.querySelector("[data-part=rule]"))).toBe(
      "✓ Kubernetes: shipping to a cluster run by others",
    );
    expect(textOf(at("[data-part=count]"))).toBe("1 of 2 answered");
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(
      "Did you write the Dockerfiles or run the registry?",
    );
    // No done state, and no exit: there is nothing on this screen that ends it.
    expect(textOf(page())).not.toContain("That is all I needed.");
    expect(textOf(page())).not.toMatch(/\bDone\b|\bFinish\b/);
  });

  it("greets the person back rather than replaying the finished run's opener", async () => {
    profileIs(aReturn());
    const { at, page } = await opened();

    expect(textOf(at("profile-assistant"))).toContain("Welcome back.");
    expect(textOf(page())).not.toContain("I read your 5 documents");
    expect(textOf(at("profile-bar"))).toContain("From 5 documents, read on");
  });
});
