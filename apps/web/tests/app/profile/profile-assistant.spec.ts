import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import { ProfileAssistant } from "../../../src/app/profile/profile-assistant/profile-assistant";
import {
  conversationIs,
  type Entry,
  entryOf,
  type Question,
  questionOf,
  resetIntake,
} from "../../support/intake";
import { reset } from "../../support/session";

/**
 * Seam C: `profile/profile-assistant`, rendered (criteria 4, 8).
 *
 * Behind it: the questions, which arrive as an input the way the viewer hands them over,
 * and since agent-consolidation `SL2` the conversation, held by the `AssistantCore` the
 * screen provides and answered by the RPC client stood in for per case. What is asserted
 * is the text a person reads and what leaves as an output.
 *
 * Not past it: the tool's own contents, which are seam D's, and the sheet's placement,
 * which is seam E's.
 */

beforeEach(() => {
  reset();
  resetIntake();
  TestBed.configureTestingModule({ providers: provideAssistant({ name: "profile", parts: [] }) });
});

afterEach(() => {
  reset();
  resetIntake();
});

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const three: Question[] = [
  questionOf({ id: "q1", itemId: "k8s", itemTitle: "Kubernetes", lead: "Which was it?" }),
  questionOf({
    id: "q2",
    itemId: "obs",
    itemTitle: "Observability",
    lead: "Did you set it up, run it, or read it?",
  }),
  questionOf({
    id: "q3",
    itemId: "nestle",
    itemTitle: "Nestlé title",
    kind: "conflict",
    lead: "Which was on your contract?",
  }),
];

const rendered = async (questions: Question[], reading = { documents: 5, facts: 0 }) => {
  const fixture = TestBed.createComponent(ProfileAssistant);
  fixture.componentRef.setInput("questions", questions);
  fixture.componentRef.setInput("reading", reading);
  // The viewer's part, stood in (`ID215`): an activation is handled as a press on the
  // question's item, which is what hands the column its `on`.
  fixture.componentInstance.activate.subscribe(({ itemId }) => {
    const question = questions.find((each) => each.itemId === itemId);
    fixture.componentRef.setInput("on", {
      itemId,
      where: question?.itemTitle ?? "",
      lineId: null,
    });
  });
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return { fixture, element, at: (selector: string) => element.querySelector(selector) };
};

describe("the count (criterion 4)", () => {
  it("counts what is answered, and never shows a percentage", async () => {
    const { element, at } = await rendered(three);

    expect(textOf(at("[data-part=count]"))).toBe("0 of 3 answered");
    expect(textOf(element)).not.toContain("%");
    expect(element.querySelector("[aria-valuenow]")).toBeNull();
  });

  it("says how many are left for the builder once one is skipped", async () => {
    const { at } = await rendered([
      { ...(three[0] as Question), state: "answered" },
      { ...(three[1] as Question), state: "skipped" },
      three[2] as Question,
    ]);

    expect(textOf(at("[data-part=count]"))).toBe("1 of 3 answered, 1 for the builder");
  });
});

describe("the reading and the first question (criterion 4)", () => {
  it("opens the first waiting question with no click at all", async () => {
    const { at } = await rendered(three);

    expect(at("scope-tool")).not.toBeNull();
    expect(textOf(at("[data-part=lead]"))).toBe("Which was it?");
    expect(textOf(at("[data-part=opener]"))).toBe("First, Kubernetes.");
    expect(at("[data-part=prefix]")).not.toBeNull();
    // The chip names the relation and never the item: the title is data, and data is
    // in the tool below it (the person, 2026-09-12).
    expect(textOf(at("[data-part=what]"))).toBe("Adjusting scope");
  });

  it("opens the first one still waiting when a person comes back", async () => {
    const { at } = await rendered([
      { ...(three[0] as Question), state: "answered" },
      three[1] as Question,
      three[2] as Question,
    ]);

    expect(textOf(at("[data-part=lead]"))).toBe("Did you set it up, run it, or read it?");
    expect(textOf(at("[data-part=opener]"))).toBe("Next, Observability.");
  });

  it("shows the documents read and what is left to say, and no figure it cannot count", async () => {
    const { element, at } = await rendered(three, { documents: 5, facts: 287 });

    expect(textOf(at("[data-figure=documents] b"))).toBe("5");
    expect(textOf(at("[data-figure=facts] b"))).toBe("287");
    expect(textOf(at("[data-figure=left] b"))).toBe("3");
    expect(textOf(element)).toContain("things only you know");
  });

  it("draws no count of facts when the reading cannot honestly give one", async () => {
    const { at } = await rendered(three, { documents: 5, facts: 0 });

    expect(at("[data-figure=facts]")).toBeNull();
    expect(at("[data-figure=documents]")).not.toBeNull();
  });
});

describe("what leaves the column (criteria 6, 8)", () => {
  it("says which question was answered, and with what", async () => {
    const { fixture, element } = await rendered(three);
    const said: unknown[] = [];
    fixture.componentInstance.answered.subscribe((event) => said.push(event));

    element.querySelectorAll<HTMLButtonElement>("[data-action=alt]")[0]?.click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>("[data-part=send]")?.click();
    await fixture.whenStable();

    expect(said).toEqual([{ questionId: "q1", optionId: "q1-1" }]);
  });

  it("saves nothing until a row is picked or something is typed", async () => {
    const { fixture, element } = await rendered(three);
    const send = () => element.querySelector<HTMLButtonElement>("[data-part=send]");

    expect(send()?.disabled).toBe(true);
    // One icon for every commit (the person, 2026-09-14); its name still says which.
    expect(send()?.getAttribute("aria-label")).toBe("Save");

    element.querySelectorAll<HTMLButtonElement>("[data-action=alt]")[0]?.click();
    await fixture.whenStable();
    expect(send()?.disabled).toBe(false);
  });

  it("treats the prefix's × as a skip while a question is waiting", async () => {
    const { fixture, element } = await rendered(three);
    const skipped: unknown[] = [];
    fixture.componentInstance.skipped.subscribe((event) => skipped.push(event));

    element.querySelector<HTMLButtonElement>("[data-action=clear]")?.click();
    await fixture.whenStable();

    expect(skipped).toEqual([{ questionId: "q1" }]);
  });

  it("says which question was skipped when the foot's skip is pressed", async () => {
    const { fixture, element } = await rendered(three);
    const skipped: unknown[] = [];
    fixture.componentInstance.skipped.subscribe((event) => skipped.push(event));

    element.querySelector<HTMLButtonElement>("[data-action=skip]")?.click();
    await fixture.whenStable();

    expect(skipped).toEqual([{ questionId: "q1" }]);
  });
});

/**
 * The opening is the conversation's first entry (agent-consolidation `SL2`, `S2.3`,
 * `US8`). Its words here are not the words this column would compose from its inputs —
 * seven documents against an input of five — so what is drawn can only be what is stored.
 */
describe("the opening, as the conversation stored it (S2.3, US8)", () => {
  const sentence =
    "I read your 7 documents. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.";
  const tail = "Some facts say what you did but not what your part was. I ask only those.";
  const opening = entryOf(1, [
    { kind: "text", text: sentence, scripted: true },
    { kind: "text", text: tail, scripted: true },
    { kind: "text", text: "First, Kubernetes.", scripted: true },
  ]);

  it("performs the opening when it is the conversation's one entry", async () => {
    conversationIs([opening]);
    await TestBed.inject(AssistantCore).open();

    const { fixture, element, at } = await rendered(three);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.getAttribute("data-guide")).toBe("done");
    });
    expect(textOf(at("[data-part=opening]"))).toBe(sentence);
    expect(textOf(at("[data-part=tail]"))).toBe(tail);
  });

  it("shows every entry at once, and performs nothing, when the opening is not alone", async () => {
    conversationIs([
      opening,
      entryOf(2, [{ kind: "text", text: "I ran the services, not the cluster." }], "person"),
    ]);
    await TestBed.inject(AssistantCore).open();

    const { fixture, element, at } = await rendered(three);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(at("scope-tool")).not.toBeNull();
    });
    expect(element.hasAttribute("data-guide")).toBe(false);
    expect(textOf(at("[data-part=opening]"))).toBe(sentence);
    expect(textOf(element)).toContain("I ran the services, not the cluster.");
    expect(textOf(element).split(sentence)).toHaveLength(2);
  });
});

/**
 * Seam E: a free message in the profile's column (`SL3`, `US2`, `US3`, `ID176`). The core
 * is stood in at its seam: its entries, its reply and its failure set per case, and what
 * is posted recorded. What is asserted is text a person reads and keys a person presses.
 */
describe("a free message (SL3, US2, US3)", () => {
  type Stood = {
    entries: WritableSignal<Entry[]>;
    replying: WritableSignal<string | null>;
    failure: WritableSignal<string | null>;
    activity: WritableSignal<string | null>;
    post: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
  };

  const opening = entryOf(1, [
    { kind: "text", text: "I read your 5 documents.", scripted: true },
    { kind: "text", text: "I ask only those.", scripted: true },
  ]);
  const message = entryOf(2, [{ kind: "text", text: "I ran the services." }], "person");
  const reply = entryOf(3, [{ kind: "text", text: "No pre generated text" }]);

  const standIn = (entries: Entry[] = []): Stood => {
    const stood: Stood = {
      entries: signal(entries),
      replying: signal<string | null>(null),
      failure: signal<string | null>(null),
      activity: signal<string | null>(null),
      post: vi.fn(async () => {}),
      open: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
    };
    TestBed.overrideProvider(AssistantCore, { useValue: stood });
    return stood;
  };

  const typeInto = (element: HTMLElement, words: string): void => {
    const field = element.querySelector<HTMLInputElement>("[data-part=composer]");
    if (field === null) throw new Error("no composer");
    field.value = words;
    field.dispatchEvent(new Event("input"));
  };

  it("posts the typed text once with nothing open, on Enter, and the composer is back to one empty line", async () => {
    const core = standIn();
    const { fixture, element } = await rendered(
      three.map((question) => ({ ...question, state: "answered" as const })),
    );

    typeInto(element, "I ran the services.");
    await fixture.whenStable();
    element
      .querySelector<HTMLInputElement>("[data-part=composer]")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await fixture.whenStable();

    expect(core.post).toHaveBeenCalledTimes(1);
    expect(core.post).toHaveBeenCalledWith("I ran the services.");
    expect(element.querySelector("textarea")).toBeNull();
    expect(element.querySelector<HTMLInputElement>("[data-part=composer]")?.value).toBe("");
  });

  it("posts the typed text as a message with a question open and no pick, and the question stays open", async () => {
    const core = standIn();
    const { fixture, element, at } = await rendered(three);
    const answered: unknown[] = [];
    fixture.componentInstance.answered.subscribe((event) => answered.push(event));

    typeInto(element, "Can I say something else first?");
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>("[data-part=send]")?.click();
    await fixture.whenStable();

    expect(core.post).toHaveBeenCalledWith("Can I say something else first?");
    expect(answered).toEqual([]);
    expect(at("scope-tool")).not.toBeNull();
    expect(textOf(at("[data-part=lead]"))).toBe("Which was it?");
    expect(textOf(at("[data-part=count]"))).toBe("0 of 3 answered");
  });

  it("draws the reply as it streams, under the message", async () => {
    const core = standIn([opening, message]);
    core.replying.set("No pre");
    const { fixture, element } = await rendered(three);
    await fixture.whenStable();

    const said = textOf(element);
    expect(textOf(element.querySelector("[data-part=replying]"))).toBe("No pre");
    expect(said.indexOf("I ran the services.")).toBeLessThan(said.indexOf("No pre"));
  });

  it("draws the message and the reply at once, in order, after a reload", async () => {
    standIn([opening, message, reply]);
    const { fixture, element } = await rendered(three);
    await fixture.whenStable();

    const said = textOf(element);
    expect(said).toContain("I ran the services.");
    expect(said.indexOf("I ran the services.")).toBeLessThan(said.indexOf("No pre generated text"));
    expect(element.hasAttribute("data-guide")).toBe(false);
  });

  it("says a failure in one sentence, and the message is still there", async () => {
    const core = standIn([opening, message]);
    core.failure.set("The assistant could not answer this time. Your message is kept.");
    const { fixture, element } = await rendered(three);
    await fixture.whenStable();

    expect(
      Array.from(element.querySelectorAll("[data-part=failure]")).map((each) => textOf(each)),
    ).toEqual(["The assistant could not answer this time. Your message is kept."]);
    expect(textOf(element)).toContain("I ran the services.");
  });
});

describe("when nothing is left", () => {
  it("closes the dock and says so, and the dock was open until then", async () => {
    const open = await rendered(three);
    expect(open.at("[data-part=dock]")).not.toBeNull();

    const { element, at } = await rendered(
      three.map((question) => ({ ...question, state: "answered" as const })),
    );

    expect(at("[data-part=dock]")).toBeNull();
    expect(at("[data-part=prefix]")).toBeNull();
    expect(textOf(element)).toContain("That is all I needed.");
    expect(textOf(element)).toContain(
      "Your profile is ready. Start an application, or click anything on the right to correct it.",
    );
  });
});
