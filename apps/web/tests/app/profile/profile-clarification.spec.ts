import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import {
  type Entry,
  emptyProfile,
  entryOf,
  intakeRequests,
  itemOf,
  messagesPosted,
  type Profile,
  profileIs,
  type Question,
  questionOf,
  resetIntake,
  theReply,
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
      lines: [
        { id: "line-migration", text: "Ran the migration programme", documents: 1, sources: [] },
      ],
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

/** Every request the screen made to the rule route, which a clarification no longer calls. */
const ruleRequests = () => intakeRequests().filter((each) => each.address.endsWith("/rule"));

/** The person's entry the API committed for the message, then the reply's end. */
const theyWrote = (parts: Entry["parts"]): void => {
  theReply.says({ kind: "entry", entry: entryOf(2, parts, "person") });
  theReply.says({ kind: "done" });
  theReply.ends();
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
      "What you write goes into the conversation, about this.",
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
    expect(textOf(at("[data-part=what]"))).toBe("Adjusting scope");
    // Nothing else in the assistant's column names it: the prefix is the only place the
    // clicked thing is said, and no sentence is composed about it anywhere.
    const said = textOf(at("profile-assistant")).split("Kubernetes").length - 1;
    expect(said).toBe(1);
  });

  it("closes on the prefix's ×, the one way out, and writes nothing", async () => {
    profileIs(aProfile());
    const { at, press, eventually } = await opened();
    await press("chip-k8s");

    // The tool has no Cancel of its own any more (the person, 2026-09-13).
    expect(at("[data-action=cancel]")).toBeNull();
    (at("[data-action=clear]") as HTMLButtonElement).click();

    await eventually(() => expect(at("scope-tool")).toBeNull());
    expect(at("[data-part=rule]")).toBeNull();
  });
});

describe("a click on an item whose question is still open (the person, 2026-09-13)", () => {
  const docker = (state: "waiting" | "skipped") =>
    questionOf({
      id: "q-docker",
      itemId: "chip-docker",
      itemTitle: "Docker",
      lead: "Did you write the Dockerfiles or run the registry?",
      state,
    });

  it("opens the question waiting on it, with its own rows, and never the sentence", async () => {
    profileIs(aProfile([docker("waiting")]));
    const { at, all, press } = await opened();

    await press("chip-docker");

    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(
      "Did you write the Dockerfiles or run the registry?",
    );
    expect(all("[data-action=alt]").length).toBeGreaterThan(0);
  });

  it("reopens a question that was skipped, with its own rows, so it can still be answered", async () => {
    profileIs(aProfile([docker("skipped")]));
    const { at, all, press } = await opened();

    await press("chip-docker");

    // The mark still says `scope to clarify` on it: the appropriate tool is the question, not
    // the one-sentence tool that proposes nothing.
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(
      "Did you write the Dockerfiles or run the registry?",
    );
    expect(all("[data-action=alt]").length).toBeGreaterThan(0);
    expect(textOf(at("[data-part=what]"))).toBe("Adjusting scope");
  });
});

describe("a click on a line (the person, 2026-09-13)", () => {
  it("opens the tool on the line, saying where it is and not what it says", async () => {
    profileIs(aProfile());
    const { at, press } = await opened();

    await press("line-migration");

    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(theSentence);
    // The path, not the sentence: the sheet has lifted the line already, and a bullet
    // repeated here would be the same thing said twice (the person, 2026-09-13). What
    // the highlight cannot say is which row of which post is about to be written on —
    // and the composer says it now, beside the words about it (the person, 2026-09-14).
    expect(textOf(at("composer [data-part=where]"))).toBe(
      "R&D Collaborator in Software Engineering · row 1",
    );
    expect(textOf(at("profile-assistant"))).not.toContain("Ran the migration programme");
  });

  it("posts what is written as a message about the line, and writes no rule (S8.7)", async () => {
    profileIs(aProfile());
    const { at, region, press, type, saveIt, eventually } = await opened();

    await press("line-migration");
    await type("I coordinated it, others ran it");
    await saveIt();

    await eventually(() =>
      expect(messagesPosted()).toEqual([
        {
          address: "/api/conversations/profile/messages",
          text: "I coordinated it, others ran it",
          about: { itemId: "post-heig", lineId: "line-migration" },
        },
      ]),
    );
    expect(ruleRequests()).toEqual([]);
    const where = "R&D Collaborator in Software Engineering · row 1";
    theyWrote([
      { kind: "about", itemId: "post-heig", lineId: "line-migration", where },
      { kind: "text", text: "I coordinated it, others ran it" },
    ]);
    await eventually(() =>
      expect(textOf(at("profile-assistant [data-msg=person] [data-part=about]"))).toBe(where),
    );
    expect(region("post-heig")?.querySelector("[data-part=rule]")).toBeNull();
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
      // Closing is the prefix's × and nothing else (the person, 2026-09-13).
      (at("[data-action=clear]") as HTMLButtonElement).click();
      await eventually(() => expect(at("scope-tool")).toBeNull());
    }

    expect(said).toEqual([theSentence, theSentence, theSentence]);
  });
});

/**
 * What the person writes about an item is a message naming it (agent-consolidation `S8.7`,
 * `ID233`): posted through the core with what it is about, never to the rule route, and
 * drawn with its where above the person's bubble, in the bubble's fixed colours (`ID232`).
 */
describe("what the person writes about an item is a message naming it (S8.7)", () => {
  it.each([
    ["chip-k8s", "Kubernetes", "I shipped to a cluster somebody else ran"],
    ["project-opendidac", "Opendidac", "I wrote the back end, never the teaching content"],
    ["post-heig", "R&D Collaborator in Software Engineering", "It was a part-time post"],
  ])("posts it about %s, writes no rule, and draws it with its where", async (id, title, words) => {
    profileIs(aProfile());
    const { at, region, press, type, saveIt, eventually } = await opened();

    await press(id);
    await type(words);
    await saveIt();

    await eventually(() =>
      expect(messagesPosted()).toEqual([
        { address: "/api/conversations/profile/messages", text: words, about: { itemId: id } },
      ]),
    );
    expect(ruleRequests()).toEqual([]);
    theyWrote([
      { kind: "about", itemId: id, where: title },
      { kind: "text", text: words },
    ]);
    await eventually(() =>
      expect(textOf(at("profile-assistant [data-msg=person]"))).toContain(words),
    );
    const about = at("profile-assistant [data-msg=person] [data-part=about]");
    expect(textOf(about)).toBe(title);
    expect(about?.classList.contains("bg-send")).toBe(true);
    expect(about?.classList.contains("text-white")).toBe(true);
    expect(textOf(at("profile-assistant"))).not.toContain("This part cannot be shown here.");
    expect(region(id)?.querySelector("[data-part=rule]")).toBeNull();
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
    // Closing is the prefix's × and nothing else (the person, 2026-09-13).
    (at("[data-action=clear]") as HTMLButtonElement).click();
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

/**
 * What the column does with nobody touching it (the person, 2026-09-13).
 *
 * The first question opens the instant the profile arrives, and the item it is about is
 * usually far down the sheet. The column has to go there — which it did not, for a
 * while: the reveal ran on the same change that opened the question, asked the sheet for
 * an item the sheet had not drawn yet, found nothing, and never ran again. `data-at` is
 * what catches it, because a runtime with no layout has no other way to see it.
 */
describe("the column, before anybody clicks anything", () => {
  it("follows the first question's own item, without a click", async () => {
    profileIs(
      aProfile([
        questionOf({
          id: "q1",
          itemId: "chip-docker",
          itemTitle: "Docker",
          lead: "Did you write the Dockerfiles or run the registry?",
        }),
      ]),
    );
    const { at, columnIsAt, eventually } = await opened();

    await eventually(() => {
      expect(at("scope-tool")).not.toBeNull();
      expect(columnIsAt()).toBe("region");
    });
  });
});

/**
 * What the guided sequence does and does not gate (`2026-09-13-guided-effects.spec.md`,
 * and the person, 2026-09-13).
 */
describe("the opening sequence", () => {
  it("opens the tool whenever something is still to clarify, sequence or no sequence", async () => {
    profileIs(
      aProfile([
        questionOf({
          id: "q1",
          itemId: "chip-docker",
          itemTitle: "Docker",
          lead: "Did you write the Dockerfiles or run the registry?",
        }),
      ]),
    );
    const { at, eventually } = await opened();

    await eventually(() => {
      expect(at("scope-tool")).not.toBeNull();
      expect(at("[data-guide]")?.getAttribute("data-guide")).toBe("done");
    });
  });

  it("says the whole opening at once when the conversation is not new", async () => {
    // A person coming back: the column is resumed, not begun, so nothing is performed —
    // and the words are all there regardless.
    profileIs(aProfile());
    const { at, eventually } = await opened();

    await eventually(() => {
      expect(textOf(at("[data-part=opening]"))).toContain("Every fact on the right carries");
      expect(textOf(at("[data-part=tail]"))).toContain("I ask only those");
    });
  });
});
