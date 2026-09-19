import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import { GUIDE_PACE, type GuidePace } from "../../../src/app/guide/pace";
import {
  conversationIs,
  emptyProfile,
  entryOf,
  intakeRequests,
  itemOf,
  type Profile,
  profileIs,
  type Question,
  questionOf,
  resetIntake,
} from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * **Out of collection since product-flow-rework `S2.1`, and owed to `profile-assistant`.**
 * Every case below mounts `/profile` and reads the assistant that used to be on it. The
 * assistant left the intake (`ID331`), so none of them has a subject at that route any
 * more — but they are the walks `profile-assistant` will want the day the column comes
 * back (`ID330`), so they stay in the tree, named in `apps/web/angular.json`'s `exclude`,
 * rather than being deleted or skipped. Whoever rebuilds that slot rewrites them against
 * the seam it has and puts the file back in collection.
 *
 * Seam A: the profile screen, `ProfileViewer` rendered with `ProfileAssistant` inside it
 * (agent-consolidation `SL8`, `S8.1`, `S8.2`, `S8.3`; `ID215`, `ID216`, `ID217`, `ID218`,
 * `ID219`).
 *
 * Behind it: the intake's routes and the conversation, stood in for at `fetch`
 * (`tests/support/intake.ts`); a case that holds or refuses the answer route wraps that
 * stand-in and puts the suite's own back afterwards, never the platform's (`ID204`). The
 * guide's pace is zero (`G7`) unless a case steps it to look inside the performance.
 *
 * Not past it: the reveal's arithmetic and the scope tool's rows, which have their own
 * files. What is read is rendered text, `data-guide` and `data-at`, never a field.
 */

const person = {
  name: "Stefan Teofanovic",
  email: "stefan@example.com",
  providers: ["google" as const],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const chip = (id: string, label: string) =>
  itemOf({ id, kind: "entry", title: label, entry: { label, qualifier: null } });

const kubernetes = questionOf({
  id: "q1",
  itemId: "chip-k8s",
  itemTitle: "Kubernetes",
  lead: "Which was it?",
});

const docker = questionOf({
  id: "q2",
  itemId: "chip-docker",
  itemTitle: "Docker",
  lead: "Did you write the Dockerfiles or run the registry?",
});

/** Five documents read today, and a group of two chips each question can be about. */
const aProfile = (questions: Question[]): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 5,
  readOn: new Date().toISOString(),
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

/** The opening the conversation route writes for five documents (`tests/support/intake`). */
const sentence =
  "I read your 5 documents. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.";
const tail =
  "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.";

/** A pace at which each message takes a fraction of a second: the whole run can be watched. */
const stepped: GuidePace = { perMessageMs: 150, firstBeatMs: 0 };

/** A pace so slow the case stands inside the first sentence until it does something. */
const holding: GuidePace = { perMessageMs: 60_000, firstBeatMs: 0 };

/** The suite's own stand-in for `fetch`, taken before a case wraps it and put back after. */
let suiteFetch: typeof fetch;

beforeEach(() => {
  reset();
  resetIntake();
  signedInAs(person);
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  suiteFetch = globalThis.fetch;
});

afterEach(() => {
  vi.stubGlobal("fetch", suiteFetch);
  reset();
  resetIntake();
});

const addressOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);

/** The answer action answered by `route`; every other request still reaches the stand-in. */
const answerRouteIs = (
  route: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    /^\/api\/conversations\/[^/]+\/actions\/answer_question$/.test(
      new URL(addressOf(input), "http://localhost").pathname,
    )
      ? route(input, init)
      : suiteFetch(input, init),
  );
};

/** Everything a tool's activation turns on, each read on its own. */
type Active = {
  label: boolean;
  path: boolean;
  choices: boolean;
  lifted: boolean;
  dimmed: boolean;
  revealed: boolean;
  waiting: boolean;
};

const nothingActive: Active = {
  label: false,
  path: false,
  choices: false,
  lifted: false,
  dimmed: false,
  revealed: false,
  waiting: false,
};

const everythingActive: Active = {
  label: true,
  path: true,
  choices: true,
  lifted: true,
  dimmed: true,
  revealed: true,
  waiting: true,
};

const opened = async (pace?: GuidePace) => {
  if (pace !== undefined) TestBed.overrideProvider(GUIDE_PACE, { useValue: pace });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl("/profile");
  const page = () => harness.routeNativeElement;

  // Every step the sequence names, in the order the host carried them (`G8`), watched from
  // before the assistant's column exists.
  const changes: (string | null)[] = [];
  const watching = new MutationObserver((records) => {
    for (const record of records) changes.push(record.oldValue);
  });
  const viewer = page();
  if (viewer !== null) {
    watching.observe(viewer, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-guide"],
      attributeOldValue: true,
    });
  }

  const eventually = (assert: () => void, timeout = 1000) =>
    vi.waitFor(
      () => {
        harness.detectChanges();
        assert();
      },
      { timeout },
    );
  const at = (selector: string) => page()?.querySelector(selector) ?? null;
  const all = (selector: string) => Array.from(page()?.querySelectorAll(selector) ?? []);
  const region = (id: string) =>
    page()?.querySelector<HTMLElement>(`[data-region][data-id="${id}"]`) ?? null;
  const guide = () => at("profile-assistant")?.getAttribute("data-guide") ?? null;
  const steps = () => [
    ...changes.filter((each): each is string => each !== null),
    ...(guide() === null ? [] : [guide() as string]),
  ];
  const active = (): Active => ({
    label: at("[data-part=what]") !== null,
    path: textOf(at("composer [data-part=where]")) !== "",
    choices: all("[data-action=alt]").length > 0,
    lifted: all("[data-selected=true]").length > 0,
    dimmed: at("profile-sheet article")?.getAttribute("data-focused") === "true",
    revealed: at("[data-at]")?.getAttribute("data-at") === "region",
    waiting: at("[data-part=waiting]") !== null,
  });
  /** What a person sees of an active tool, whole, to compare one activation with another. */
  const state = () => ({
    label: textOf(at("[data-part=what]")),
    path: textOf(at("composer [data-part=where]")),
    lead: textOf(at("scope-tool [data-part=lead]")),
    choices: all("[data-action=alt]").map((each) => textOf(each)),
    lifted: all("[data-selected=true]").map((each) => each.getAttribute("data-id")),
    dimmed: at("profile-sheet article")?.getAttribute("data-focused") ?? null,
    at: at("[data-at]")?.getAttribute("data-at") ?? null,
    waiting: textOf(at("[data-part=waiting]")),
  });
  const pick = async (row: number) => {
    (all("[data-action=alt]")[row] as HTMLButtonElement).click();
    await eventually(() =>
      expect((at("[data-part=send]") as HTMLButtonElement | null)?.disabled).toBe(false),
    );
    (at("[data-part=send]") as HTMLButtonElement).click();
  };

  await eventually(() => expect(at("profile-sheet")).not.toBeNull());
  return { harness, at, all, region, guide, steps, active, state, pick, eventually };
};

describe("a brand-new conversation, performed (S8.1, S8.2)", () => {
  it("says the opening, shows the card, says the tail and the first opener, in that order, and then activates", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, guide, steps, eventually } = await opened();

    await eventually(() => expect(guide()).toBe("done"));

    expect(steps()).toEqual(["opening", "card", "tail", "opener", "activate", "done"]);
    expect(textOf(at("[data-part=opening]"))).toBe(sentence);
    expect(textOf(at("[data-part=tail]"))).toBe(tail);
    expect(textOf(at("[data-part=opener]"))).toBe("First, Kubernetes.");
    const said = textOf(at("profile-assistant"));
    expect(said.indexOf(tail)).toBeLessThan(said.indexOf("First, Kubernetes."));
    // A performed line is timed when it was said (`ID220`).
    const opener = at("[data-part=opener]")?.closest("[data-msg]");
    expect(textOf(opener?.querySelector("[data-part=at]"))).toBe("just now");
  });

  it("holds the composer and the profile still until the last word, then turns everything on in one render", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { harness, guide, active, eventually } = await opened(stepped);

    const seen: ({ guide: string | null } & Active)[] = [];
    const looking = setInterval(() => {
      harness.detectChanges();
      seen.push({ guide: guide(), ...active() });
    }, 2);
    await eventually(() => {
      expect(guide()).toBe("done");
      expect(active()).toEqual(everythingActive);
    }, 3000);
    clearInterval(looking);

    const performing = seen.filter(
      (each) => each.guide !== null && each.guide !== "activate" && each.guide !== "done",
    );
    expect(performing.map((each) => each.guide)).toEqual(
      expect.arrayContaining(["opening", "tail", "opener"]),
    );
    for (const { guide: step, ...flags } of performing) {
      expect({ step, ...flags }).toEqual({ step, ...nothingActive });
    }
    // Never some of it without the rest: what one activation turns on, it turns on at once.
    for (const { guide: step, ...flags } of seen) {
      const on = Object.values(flags).filter(Boolean).length;
      expect({ step, on }).toEqual({ step, on: on === 0 ? 0 : 7 });
    }
  });

  it("lands every word and activates the tool at once when the person presses mid-performance (G2)", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, guide, active, eventually } = await opened(holding);
    await eventually(() => expect(textOf(at("[data-part=opening]"))).not.toBe(""));
    expect(guide()).toBe("opening");
    expect(textOf(at("[data-part=opening]"))).not.toBe(sentence);
    expect(active()).toEqual(nothingActive);

    at("profile-assistant")?.dispatchEvent(new Event("pointerdown"));

    await eventually(() => {
      expect(guide()).toBe("done");
      expect(active()).toEqual(everythingActive);
    });
    expect(textOf(at("[data-part=opening]"))).toBe(sentence);
    expect(textOf(at("[data-part=tail]"))).toBe(tail);
    expect(textOf(at("[data-part=opener]"))).toBe("First, Kubernetes.");
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(kubernetes.lead);
  });

  it("shows a conversation already under way at once, the tool active, and performs nothing", async () => {
    profileIs(aProfile([kubernetes, docker]));
    conversationIs([
      entryOf(1, [
        { kind: "text", text: sentence, scripted: true },
        { kind: "text", text: tail, scripted: true },
      ]),
      entryOf(2, [{ kind: "text", text: "I ran the services." }], "person"),
    ]);
    const { at, active, eventually } = await opened(holding);

    await eventually(() => expect(active()).toEqual(everythingActive));
    expect(at("profile-assistant")?.hasAttribute("data-guide")).toBe(false);
    expect(textOf(at("[data-part=opening]"))).toBe(sentence);
    // A resumed column says no opener (`ID297`): what is stored, and the tool.
    expect(at("[data-part=opener]")).toBeNull();
    expect(textOf(at("[data-part=waiting]"))).toContain("Kubernetes");
  });

  it("gives exactly the state a press on the same item gives, and the dimmed profile pressed puts it down", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, region, active, state, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));
    const activated = state();
    expect(activated.label).toBe("Adjusting scope");
    expect(activated.lifted).toEqual(["chip-k8s"]);

    (at("profile-sheet article") as HTMLElement).click();
    await eventually(() => expect(at("scope-tool")).toBeNull());
    expect(at("[data-part=waiting]")).toBeNull();

    region("chip-k8s")?.click();
    await eventually(() => expect(state()).toEqual(activated));
  });
});

describe("the column keeps its thread for the visit (S8.4b, ID227)", () => {
  const terraform = questionOf({
    id: "q3",
    itemId: "chip-terraform",
    itemTitle: "Terraform",
    lead: "Did you write the modules or apply them?",
  });

  const threeChips = (): Profile => {
    const profile = aProfile([kubernetes, docker, terraform]);
    return {
      ...profile,
      groups: [
        itemOf({
          id: "group-devops",
          kind: "group",
          title: "DevOps and cloud",
          children: [
            chip("chip-k8s", "Kubernetes"),
            chip("chip-docker", "Docker"),
            chip("chip-terraform", "Terraform"),
          ],
        }),
      ],
    };
  };

  /** What the column reads, top to bottom: each performed line's words, each stored part's kind. */
  const thread = (all: (selector: string) => Element[]): string[] =>
    all(
      "profile-assistant :is([data-part=opening], [data-part=opener], [data-part=ack], [data-part=answered], [data-part=skipped], [data-part=waiting])",
    ).map((each) => {
      const part = each.getAttribute("data-part");
      return part === "opener" || part === "ack" ? textOf(each) : (part ?? "");
    });

  it("reads every performed line in order after two decisions, and a reload shows only what was stored", async () => {
    profileIs(threeChips());
    const { at, all, active, pick, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    await pick(0);
    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));
    (at("[data-action=skip]") as HTMLButtonElement).click();
    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(terraform.lead));

    expect(thread(all)).toEqual([
      "opening",
      "First, Kubernetes.",
      "answered",
      "skipped",
      "waiting",
    ]);
    // One reply to one decision (`ID293`): nothing of the column's own after a kept one.
    for (const said of ["Noted.", "Put aside for later.", "Next, Docker.", "Next, Terraform."]) {
      expect(textOf(at("profile-assistant"))).not.toContain(said);
    }

    // A reload keeps nothing in the page: the stored entries come back, the lines said
    // on the way do not.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    const again = await opened();
    await again.eventually(() => expect(again.active()).toEqual(everythingActive));
    const reloaded = thread(again.all);
    expect(reloaded.filter((each) => ["opening", "answered", "skipped"].includes(each))).toEqual([
      "opening",
      "answered",
      "skipped",
    ]);
    for (const said of ["First, Kubernetes.", "Noted.", "Next, Docker.", "Put aside for later."]) {
      expect(reloaded).not.toContain(said);
    }
  });
});

describe("a decision, then the agent's reply (D31, ID291)", () => {
  /** What the column reads: each performed line's words, the person's decision, the agent's words. */
  const column = (all: (selector: string) => Element[]): string[] =>
    all(
      "profile-assistant :is([data-part=opener], [data-part=ack], [data-part=answered], [data-part=skipped], [data-entry][data-msg=assistant])",
    ).map((each) =>
      each.hasAttribute("data-entry")
        ? `agent: ${textOf(each.querySelector("p"))}`
        : each.getAttribute("data-part") === "opener" || each.getAttribute("data-part") === "ack"
          ? textOf(each)
          : (each.getAttribute("data-part") ?? ""),
    );

  it("reads the agent's reply as the one reply to the person's decision, no Noted. and no Next line (ID293)", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, all, active, pick, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    await pick(0);
    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));

    expect(column(all)).toEqual(["First, Kubernetes.", "answered", "agent: No pre generated text"]);
    expect(active()).toEqual(everythingActive);
    expect(intakeRequests().filter((request) => request.address.includes("/actions/"))).toEqual([
      { method: "POST", address: "/api/conversations/profile/actions/answer_question" },
    ]);
  });
});

describe("between tools (S8.3, ID217, ID293)", () => {
  it("thinks while the answer is saved, then says nothing of its own and activates the next question", async () => {
    profileIs(aProfile([kubernetes, docker]));
    let release = (): void => {};
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    answerRouteIs(async (input, init) => {
      await saving;
      return suiteFetch(input, init);
    });
    const { at, all, active, pick, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    await pick(0);

    await eventually(() => expect(textOf(at("[data-part=activity]"))).toBe("Thinking"));
    expect(at("[data-part=ack]")).toBeNull();

    release();

    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));
    expect(at("[data-part=activity]")).toBeNull();
    expect(at("[data-part=ack]")).toBeNull();
    expect(all("[data-part=opener]").map(textOf)).toEqual(["First, Kubernetes."]);
    const said = textOf(at("profile-assistant"));
    expect(said).not.toContain("Noted.");
    expect(said).not.toContain("Next, Docker.");
    expect(active()).toEqual(everythingActive);
    expect(textOf(at("[data-part=waiting]"))).toContain("Docker");
  });

  it("says nothing of its own after a skip, no Put aside for later., and activates the next question", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, all, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    (at("[data-action=skip]") as HTMLButtonElement).click();

    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));
    expect(at("[data-part=ack]")).toBeNull();
    expect(textOf(at("profile-assistant"))).not.toContain("Put aside for later.");
    expect(all("[data-part=opener]").map(textOf)).toEqual(["First, Kubernetes."]);
    expect(active()).toEqual(everythingActive);
    expect(textOf(at("[data-part=waiting]"))).toContain("Docker");
  });

  it("activates nothing, draws no waiting line and says That is all I needed. after the last decision", async () => {
    profileIs(aProfile([kubernetes]));
    const { at, all, active, pick, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    await pick(0);

    await eventually(() =>
      expect(textOf(at("profile-assistant"))).toContain("That is all I needed."),
    );
    expect(at("scope-tool")).toBeNull();
    expect(at("[data-part=waiting]")).toBeNull();
    expect(at("[data-part=ack]")).toBeNull();
    expect(textOf(at("[data-part=ready]"))).toContain("Your profile is ready.");
    // The reply, then the two closing lines (`ID293`).
    const said = textOf(at("profile-assistant"));
    expect(said.indexOf("No pre generated text")).toBeGreaterThan(-1);
    expect(said.indexOf("No pre generated text")).toBeLessThan(
      said.indexOf("That is all I needed."),
    );
    expect(said.indexOf("That is all I needed.")).toBeLessThan(
      said.indexOf("Your profile is ready."),
    );
    // The first opener stays for the visit (`ID227`); no next one is said after the last.
    expect(all("[data-part=opener]").map(textOf)).toEqual(["First, Kubernetes."]);
    expect(active()).toMatchObject({ label: false, choices: false, lifted: false, waiting: false });
  });

  it("keeps the tool active with the pick, and says so, when the answer is not saved", async () => {
    profileIs(aProfile([kubernetes, docker]));
    answerRouteIs(
      async () =>
        new Response(JSON.stringify({ error: "the answer could not be kept" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const { at, all, active, pick, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    await pick(0);

    await eventually(() => expect(at("[data-part=save-failure]")).not.toBeNull());
    expect(at("[data-part=activity]")).toBeNull();
    expect(at("[data-part=ack]")).toBeNull();
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(kubernetes.lead);
    expect(all("[data-action=alt]")[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(active()).toEqual(everythingActive);
  });
});

/**
 * A press away closes the tool (agent-consolidation `S8.8`, `ID236`): anywhere outside the
 * dock, the composer and the lifted region, whoever opened the tool, and that press opens
 * nothing. Escape closes it the same way. A close decides nothing.
 */
describe("a press anywhere away closes the tool (S8.8, ID236)", () => {
  /** A pointer press as a browser delivers it: the pointer going down, then the click. */
  const pressOn = (element: Element | null | undefined): void => {
    element?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    (element as HTMLElement | null | undefined)?.click();
  };

  /** What a closed tool leaves: no label, no path, no choices, no lift, no dimming, no waiting line. */
  const putDown = {
    label: false,
    path: false,
    choices: false,
    lifted: false,
    dimmed: false,
    waiting: false,
  };

  it("closes on a press on another region and opens nothing there; a second press opens that region's tool", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, region, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    pressOn(region("chip-docker"));

    await eventually(() => expect(active()).toMatchObject(putDown));
    expect(at("scope-tool")).toBeNull();

    pressOn(region("chip-docker"));

    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));
    expect(active()).toEqual(everythingActive);
  });

  it("closes on a press on the assistant's column outside the dock", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    pressOn(at("[data-part=opener]"));

    await eventually(() => expect(active()).toMatchObject(putDown));
    expect(at("scope-tool")).toBeNull();
  });

  it("closes a tool the person opened on a press on the page's bar", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, region, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));
    pressOn(region("chip-docker"));
    await eventually(() => expect(active()).toMatchObject(putDown));
    pressOn(region("chip-docker"));
    await eventually(() => expect(textOf(at("scope-tool [data-part=lead]"))).toBe(docker.lead));

    pressOn(at("profile-bar"));

    await eventually(() => expect(active()).toMatchObject(putDown));
    expect(at("scope-tool")).toBeNull();
  });

  it("closes on Escape, records no decision, and a press on the question's item reopens it", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, region, active, state, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));
    const activated = state();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await eventually(() => expect(active()).toMatchObject(putDown));
    expect(at("scope-tool")).toBeNull();
    expect(intakeRequests().filter((each) => each.address.includes("/actions/"))).toEqual([]);

    pressOn(region("chip-k8s"));

    await eventually(() => expect(state()).toEqual(activated));
  });

  it("keeps the tool on a press on the view toggle below 1024 px, and the dock shows after switching", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, all, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));
    const toggle = all("profile-bar button").find((each) => textOf(each) === "Back to the chat");
    expect(toggle).toBeDefined();

    pressOn(toggle);

    await eventually(() => expect(at("[data-view]")?.getAttribute("data-view")).toBe("chat"));
    expect(active()).toEqual(everythingActive);
    expect(at("[data-part=dock]")).not.toBeNull();
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(kubernetes.lead);
  });

  it("keeps the tool on a press on a row of the tool, in the composer and on the lifted region", async () => {
    profileIs(aProfile([kubernetes, docker]));
    const { at, all, region, active, eventually } = await opened();
    await eventually(() => expect(active()).toEqual(everythingActive));

    pressOn(all("[data-action=alt]")[1]);
    pressOn(at("[data-part=composer]"));
    pressOn(region("chip-k8s"));

    await eventually(() =>
      expect(all("[data-action=alt]")[1]?.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(active()).toEqual(everythingActive);
    expect(textOf(at("scope-tool [data-part=lead]"))).toBe(kubernetes.lead);
  });
});

/**
 * A conversation with history opens on its latest exchange (agent-consolidation `S8.9`,
 * `ID237`): once drawn, the assistant's column is kept at its end while it settles, until
 * the person scrolls or presses in it.
 *
 * jsdom lays nothing out and has no `ResizeObserver`, so the column is given a height and a
 * content height here and the observers are stood in for, to say the column changed size.
 */
describe("a conversation with history opens on its latest exchange (S8.9, ID237)", () => {
  let told: (() => void)[] = [];
  let platformObserver: typeof ResizeObserver;

  beforeEach(() => {
    told = [];
    platformObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        told.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = platformObserver;
  });

  /** The column's size changed, as every observer would report it. */
  const resized = (): void => {
    for (const callback of told) callback();
  };

  /** A stored history longer than the column: the opening and five messages after it. */
  const aHistory = () => [
    entryOf(1, [
      { kind: "text", text: sentence, scripted: true },
      { kind: "text", text: tail, scripted: true },
    ]),
    ...[2, 3, 4, 5, 6].map((position) =>
      entryOf(
        position,
        [{ kind: "text", text: `Message ${position}.` }],
        position % 2 === 0 ? "person" : "assistant",
      ),
    ),
  ];

  /** The conversation's scrolling column, given a height and a content height to scroll. */
  const laidOut = (column: HTMLElement, size: { client: number; content: number }): void => {
    let top = 0;
    Object.defineProperty(column, "clientHeight", { get: () => size.client, configurable: true });
    Object.defineProperty(column, "scrollHeight", { get: () => size.content, configurable: true });
    Object.defineProperty(column, "scrollTop", {
      get: () => top,
      set: (to: number) => {
        top = to;
      },
      configurable: true,
    });
  };

  const opening = async () => {
    profileIs(aProfile([kubernetes, docker]));
    conversationIs(aHistory());
    const screen = await opened();
    await screen.eventually(() => expect(screen.active()).toEqual(everythingActive));
    const column = screen.at("profile-assistant assistant > div") as HTMLElement;
    expect(column).not.toBeNull();
    return { ...screen, column };
  };

  it("keeps the column at its end when its content grows after the first render", async () => {
    const { column } = await opening();
    const size = { client: 300, content: 2000 };
    laidOut(column, size);
    column.scrollTop = 1700;

    size.content = 2600;
    resized();

    expect(column.scrollTop).toBeGreaterThanOrEqual(2600 - 300);
  });

  it("takes the column to its end when it gets its size after the first render, as the chat shown below 1024 px does", async () => {
    const { column } = await opening();
    const size = { client: 0, content: 0 };
    laidOut(column, size);

    size.client = 300;
    size.content = 2000;
    resized();

    expect(column.scrollTop).toBeGreaterThanOrEqual(2000 - 300);
  });

  it.each(["wheel", "pointerdown"])("stops keeping it once the person uses it: %s", async (use) => {
    const { column } = await opening();
    const size = { client: 300, content: 2000 };
    laidOut(column, size);
    column.scrollTop = 1700;

    column.dispatchEvent(new Event(use, { bubbles: true }));
    column.scrollTop = 400;
    size.content = 2600;
    resized();

    expect(column.scrollTop).toBe(400);
  });
});
