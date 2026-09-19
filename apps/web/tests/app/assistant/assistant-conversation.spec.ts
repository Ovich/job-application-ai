import { Component, signal, type Type } from "@angular/core";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assistant } from "../../../src/app/assistant/assistant/assistant";
import { AssistantConversation } from "../../../src/app/assistant/assistant-conversation/assistant-conversation";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import type { Entry as BrowserEntry } from "../../../src/app/assistant/entry";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import { CurrentUser } from "../../../src/app/auth/current-user";
import { HistoryAnswerPart } from "../../../src/app/profile/profile-assistant/history/history-answer-part/history-answer-part";
import { HistorySkipPart } from "../../../src/app/profile/profile-assistant/history/history-skip-part/history-skip-part";
import { conversationIs, type Entry, entryOf, resetIntake, theReply } from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * A concrete assistant's drawing of the parts that are not text, given as the `#part`
 * template the way `ProfileAssistant` gives it (D4). The spec's own host: the core names
 * no concrete part, so what it is handed is what a case needs.
 */
@Component({
  selector: "parts-host",
  imports: [AssistantConversation, HistoryAnswerPart, HistorySkipPart],
  template: `
    <assistant-conversation>
      <ng-template #part let-given>
        @switch (given.kind) {
          @case ("question_answered") {
            <history-answer-part [part]="given" />
          }
          @case ("question_skipped") {
            <history-skip-part [part]="given" />
          }
        }
      </ng-template>
    </assistant-conversation>
  `,
})
class PartsHost {}

/**
 * The conversation in the core assistant's column, as a concrete assistant composes it: a
 * tool that can be activated, and a line it says after entry 1 and does not store (`ID227`).
 */
@Component({
  selector: "column-host",
  imports: [Assistant, AssistantConversation],
  template: `
    <assistant [tool]="tool()">
      <assistant-conversation>
        <ng-template #afterEntry let-position>
          @if (position === 1 && said() !== "") {
            <div data-msg="ai">
              <p>{{ said() }}</p>
            </div>
          }
        </ng-template>
      </assistant-conversation>
    </assistant>
  `,
})
class ColumnHost {
  public readonly tool = signal<{ label: string; describes: string; where: string } | null>(null);

  public readonly said = signal("");
}

/**
 * Seam W: `AssistantConversation`, rendered with the core a screen provides (`S2.3`,
 * `ID175`, the spec's *Failure modes*).
 *
 * Behind it: the RPC client stood in for with the entries a case names. What is asserted
 * is the text a person reads.
 *
 * Not past it: the component's fields; and a part a provider names, which no assistant
 * provides in this slice.
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  reset();
  resetIntake();
  TestBed.configureTestingModule({ providers: provideAssistant({ name: "profile" }) });
});

afterEach(() => {
  reset();
  resetIntake();
});

const rendered = async (entries: Entry[], host: Type<unknown> = AssistantConversation) => {
  conversationIs(entries);
  await TestBed.inject(AssistantCore).open();
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

/** The `#part` template a concrete assistant gives, and none (D4). */
describe("the parts that are not text (D4)", () => {
  const answered = {
    kind: "question_answered",
    lead: "Which was it?",
    where: "What you work with · DevOps and cloud",
    options: [{ id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" }],
    picked: "q1-1",
    words: "three clusters",
  };

  it("draws a question_answered part with the #part template it is given", async () => {
    const element = await rendered(
      [
        entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
        entryOf(2, [answered], "person"),
      ],
      PartsHost,
    );

    expect(textOf(element.querySelector("history-answer-part"))).toContain("Ran the cluster");
    expect(textOf(element)).toContain("three clusters");
    expect(textOf(element)).not.toContain("This part cannot be shown here.");
  });

  it("draws the placeholder for that part when no #part template is given", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [answered], "person"),
    ]);

    expect(textOf(element)).toContain("This part cannot be shown here.");
    expect(textOf(element)).not.toContain("Ran the cluster");
  });
});

/**
 * The conversation keeps its own column at its end (D6, `ID227`, `ID237`): something new, a
 * word, an entry or a tool activated, takes it back there; the column's resizes keep it
 * there; a wheel or a press in it hands it to the person.
 *
 * jsdom lays nothing out and has no `ResizeObserver`, so the column is given a height and a
 * content height here and the observers are stood in for, to say the column changed size.
 */
describe("the column kept at its end (D6, ID227, ID237)", () => {
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

  const resized = (): void => {
    for (const callback of told) callback();
  };

  /** The column, drawn over two entries, with the size a case gives it. */
  const opened = async (size: { client: number; content: number }) => {
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "I ran the services." }], "person"),
    ]);
    await TestBed.inject(AssistantCore).open();
    const fixture = TestBed.createComponent(ColumnHost);
    await fixture.whenStable();
    const column = (fixture.nativeElement as HTMLElement).querySelector(
      "assistant > div",
    ) as HTMLElement;
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
    return { fixture, column };
  };

  const settled = async (fixture: ComponentFixture<ColumnHost>): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it.each([
    [
      "a word lands",
      async (fixture: ComponentFixture<ColumnHost>) => {
        fixture.componentInstance.said.set("Noted.");
      },
    ],
    [
      "an entry lands",
      async () => {
        const posting = TestBed.inject(AssistantCore).post("And a second thing.");
        theReply.says({
          kind: "entry",
          entry: entryOf(3, [{ kind: "text", text: "And a second thing." }], "person"),
        });
        theReply.ends();
        await posting;
      },
    ],
    [
      "a tool is activated",
      async (fixture: ComponentFixture<ColumnHost>) => {
        fixture.componentInstance.tool.set({
          label: "Adjusting scope",
          describes: "What you say next goes into the conversation, about this item.",
          where: "Kubernetes",
        });
      },
    ],
  ])(
    "takes the column back to its end when %s, after the person had scrolled away",
    async (_, land) => {
      const { fixture, column } = await opened({ client: 300, content: 2000 });
      column.dispatchEvent(new Event("wheel"));
      column.scrollTop = 400;

      await land(fixture);
      await settled(fixture);

      expect(column.scrollTop).toBe(2000);
    },
  );

  it("takes the column to its end when it gets its size after the first render", async () => {
    const size = { client: 0, content: 0 };
    const { column } = await opened(size);

    size.client = 300;
    size.content = 2000;
    resized();

    expect(column.scrollTop).toBeGreaterThanOrEqual(2000 - 300);
  });

  it.each(["wheel", "pointerdown"])("stops keeping it once the person uses it: %s", async (use) => {
    const size = { client: 300, content: 2000 };
    const { column } = await opened(size);

    column.dispatchEvent(new Event(use, { bubbles: true }));
    column.scrollTop = 400;
    size.content = 2600;
    resized();

    expect(column.scrollTop).toBe(400);
  });
});

describe("drawing the entries", () => {
  it("draws a text entry's words", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
    ]);

    expect(textOf(element)).toContain("I read your 2 documents.");
  });

  it("draws a part of a kind no provider names as a placeholder, and never drops its entry", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "First, Java." }]),
      entryOf(2, [
        { kind: "text", text: "Here is what I would change." },
        { kind: "profile_edit", before: "Ran it", after: "Ran the services" },
      ]),
    ]);

    expect(textOf(element)).toContain("First, Java.");
    expect(textOf(element)).toContain("Here is what I would change.");
    expect(textOf(element)).toContain("This part cannot be shown here.");
    expect(textOf(element)).not.toContain("Ran the services");
  });
});

/**
 * Which side an entry sits on, as a person sees it (`S4.7`, spec `H26`): pushed to the right
 * edge or not, and how wide it may grow. The test runtime lays nothing out, so the side is
 * read from the utilities that place it.
 */
const sideOf = (entry: Element | null | undefined) => {
  const classes = Array.from(entry?.classList ?? []);
  return {
    right: classes.includes("ml-auto"),
    width:
      classes.find((each) => each.startsWith("max-w-")) ??
      (classes.includes("w-full") ? "full" : "none"),
  };
};

const avatarOf = (entry: Element | null | undefined): string =>
  textOf(entry?.querySelector("[data-part=avatar]"));

/**
 * What the agent is doing, while it does it (`S7.5`, `ID210`, spec `H27`): a status leaf
 * draws its phrase beside an animated indicator on the assistant's side, a later one
 * replaces it, and the reply's first words, an entry or the end take it away.
 */
describe("what the agent is doing (S7.5, H27)", () => {
  const replying = async () => {
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
    ]);
    const core = TestBed.inject(AssistantCore);
    await core.open();
    const fixture = TestBed.createComponent(AssistantConversation);
    const element = fixture.nativeElement as HTMLElement;
    const posting = core.post("Shorten the second line.");
    theReply.says({
      kind: "entry",
      entry: entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    });
    const activity = () => element.querySelector("[data-part=activity]");
    const settled = async (assert: () => void) =>
      vi.waitFor(async () => {
        await fixture.whenStable();
        assert();
      });
    return { element, posting, activity, settled };
  };

  it("draws the phrase beside an animated indicator on the assistant's side", async () => {
    const { posting, activity, settled } = await replying();

    theReply.says({ kind: "status", text: "Reading your profile" });

    await settled(() => expect(textOf(activity())).toBe("Reading your profile"));
    const row = activity()?.closest("[data-entry]");
    expect(sideOf(row)).toEqual({ right: false, width: "full" });
    expect(row?.querySelector("svg[data-part=activity-indicator] animate")).not.toBeNull();

    theReply.ends();
    await posting;
  });

  it("replaces the phrase when a second status arrives", async () => {
    const { posting, activity, settled } = await replying();

    theReply.says({ kind: "status", text: "Reading your profile" });
    await settled(() => expect(textOf(activity())).toBe("Reading your profile"));
    theReply.says({ kind: "status", text: "Rewriting a line" });

    await settled(() => expect(textOf(activity())).toBe("Rewriting a line"));
    expect(document.querySelectorAll("[data-part=activity]").length).toBeLessThanOrEqual(1);

    theReply.ends();
    await posting;
  });

  it.each([
    ["the reply's first words", { kind: "text", text: "I will" }],
    ["an entry", { kind: "entry", entry: entryOf(3, [{ kind: "text", text: "Done." }]) }],
    ["the end", { kind: "done" }],
  ] as const)("takes the indicator away at %s", async (_, leaf) => {
    const { posting, activity, settled } = await replying();
    theReply.says({ kind: "status", text: "Reading your profile" });
    await settled(() => expect(activity()).not.toBeNull());

    theReply.says(leaf as Parameters<typeof theReply.says>[0]);

    await settled(() => expect(activity()).toBeNull());
    theReply.ends();
    await posting;
  });
});

/**
 * Seam E: when each message was written (agent-consolidation `S8.3b`, `ID220`). The clock
 * is stood in so a minute can pass without a case waiting one: only `Date` and the
 * minute's interval are faked, and everything Angular schedules keeps the real timers.
 */
describe("when each message was written (S8.3b, ID220)", () => {
  const written = new Date(2026, 8, 14, 9, 0, 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (position: number, author: Entry["author"] = "assistant"): Entry => ({
    ...entryOf(position, [{ kind: "text", text: `Message ${position}.` }], author),
    createdAt: written.toISOString(),
  });

  it("shows each entry's time as a phrase, and the full date and time on hover", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(written.getTime() + 5 * 60 * 1000));

    const element = await rendered([at(1), at(2, "person"), at(3)]);

    const times = Array.from(element.querySelectorAll("[data-entry]")).map((entry) =>
      entry.querySelector("[data-part=at]"),
    );
    expect(times.map((time) => textOf(time))).toEqual(["5 min ago", "5 min ago", "5 min ago"]);
    for (const time of times) {
      expect(time?.getAttribute("title")).toBe("14 September 2026, 09:00");
    }
  });

  it("moves the phrase on when a minute passes, with no reload", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(written.getTime() + 30 * 1000));
    conversationIs([at(1), at(2, "person")]);
    await TestBed.inject(AssistantCore).open();
    const fixture = TestBed.createComponent(AssistantConversation);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const phrases = () =>
      Array.from(element.querySelectorAll("[data-entry] [data-part=at]")).map((each) =>
        textOf(each),
      );
    expect(phrases()).toEqual(["just now", "just now"]);

    vi.advanceTimersByTime(60 * 1000);
    await fixture.whenStable();

    expect(phrases()).toEqual(["1 min ago", "1 min ago"]);
  });
});

/**
 * Inside the person's bubble the text reads from the left (agent-consolidation `S8.3b`,
 * `ID221`); only the bubble sits on the right. Read from the utilities that place it, as
 * the side is above.
 */
describe("the person's words read from the left, in a bubble on the right (S8.3b, ID221)", () => {
  const asked = {
    lead: "Which was it?",
    where: "What you work with · DevOps and cloud",
    options: [{ id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" }],
  };

  /** Every class in the entry and under it. */
  const classesIn = (entry: Element | null | undefined): string[] =>
    [entry, ...Array.from(entry?.querySelectorAll("*") ?? [])].flatMap((each) =>
      Array.from(each?.classList ?? []),
    );

  const personEntry = (element: HTMLElement) =>
    element.querySelector("[data-entry][data-msg=person]");

  it("sits a text entry on the right and aligns its text to the left", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    ]);

    const entry = personEntry(element);
    expect(sideOf(entry)).toEqual({ right: true, width: "max-w-[70%]" });
    expect(classesIn(entry)).toContain("text-left");
    expect(classesIn(entry)).not.toContain("text-right");
  });

  it.each([
    [
      "an answered part",
      { kind: "question_answered", ...asked, picked: "q1-1", words: "three clusters" },
    ],
    ["a skipped part", { kind: "question_skipped", ...asked }],
  ])("aligns %s the same way", async (_, part) => {
    const element = await rendered(
      [
        entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
        entryOf(2, [part], "person"),
      ],
      PartsHost,
    );

    const entry = personEntry(element);
    expect(sideOf(entry)).toEqual({ right: true, width: "max-w-[70%]" });
    expect(textOf(entry)).toContain("Which was it?");
    expect(classesIn(entry)).toContain("text-left");
    expect(classesIn(entry)).not.toContain("text-right");
  });
});

/**
 * The person's bubbles look the same in light and dark (agent-consolidation `S8.6`,
 * `ID232`): the bubble takes the send button's fixed blue with white text, and no line
 * inside it names a colour the theme swaps. Read from the utilities that colour it; the
 * look itself is checked on dev in both schemes.
 */
describe("the person's bubbles keep their colours in either theme (S8.6, ID232)", () => {
  /** A colour utility bound to a token the dark palette redefines. */
  const THEME_COLOUR =
    /^(text|bg)-(foreground|background|muted|muted-foreground|card|primary|primary-foreground|accent|accent-foreground)(\/\d+)?$/;

  const themeColoursIn = (element: Element | null | undefined): string[] =>
    [element, ...Array.from(element?.querySelectorAll("*") ?? [])]
      .flatMap((each) => Array.from(each?.classList ?? []))
      .filter((each) => THEME_COLOUR.test(each));

  const personEntry = (element: HTMLElement) =>
    element.querySelector("[data-entry][data-msg=person]");

  it("draws a text bubble in the send blue with white text, and nothing in it follows the theme", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    ]);

    const bubble = Array.from(personEntry(element)?.querySelectorAll("p") ?? []).find(
      (each) => textOf(each) === "Shorten the second line.",
    );
    expect(bubble?.classList.contains("bg-send")).toBe(true);
    expect(bubble?.classList.contains("text-white")).toBe(true);
    expect(themeColoursIn(bubble)).toEqual([]);
  });

  it("draws an answered part the same way, in its place in the conversation", async () => {
    const element = await rendered(
      [
        entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
        entryOf(
          2,
          [
            {
              kind: "question_answered",
              lead: "Which was it?",
              where: "What you work with · DevOps and cloud",
              options: [{ id: "q1-1", label: "Ran the cluster", hint: "nodes, upgrades, access" }],
              picked: "q1-1",
              words: "three clusters",
            },
          ],
          "person",
        ),
      ],
      PartsHost,
    );

    const bubble = personEntry(element)?.querySelector("[data-part=answered]");
    expect(bubble?.classList.contains("bg-send")).toBe(true);
    expect(bubble?.classList.contains("text-white")).toBe(true);
    expect(themeColoursIn(bubble)).toEqual([]);
  });

  it("leaves the assistant's own lines on the theme's colours", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "I shortened it." }]),
    ]);

    const line = Array.from(
      element.querySelectorAll("[data-entry][data-msg=assistant] p") ?? [],
    ).find((each) => textOf(each) === "I shortened it.");
    expect(line?.classList.contains("text-foreground")).toBe(true);
    expect(line?.classList.contains("text-white")).toBe(false);
  });
});

describe("who writes what (S4.7)", () => {
  beforeEach(async () => {
    signedInAs({ name: "Stefan Teofanovic", email: "stefan@example.com", providers: ["google"] });
    await TestBed.inject(CurrentUser).refresh();
  });

  it("draws what the assistant writes full width, behind its own avatar", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "I shortened it." }]),
    ]);

    const entry = element.querySelectorAll("[data-entry]")[1];
    expect(sideOf(entry)).toEqual({ right: false, width: "full" });
    expect(avatarOf(entry)).toBe("A");
  });

  it("draws what the person writes on the right, at most 70% wide, behind their initials", async () => {
    const element = await rendered([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    ]);

    const entry = element.querySelectorAll("[data-entry]")[1];
    expect(sideOf(entry)).toEqual({ right: true, width: "max-w-[70%]" });
    expect(avatarOf(entry)).toBe("ST");
  });

  it("draws the reply as it streams full width, as the assistant's", async () => {
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
    ]);
    const core = TestBed.inject(AssistantCore);
    await core.open();
    const fixture = TestBed.createComponent(AssistantConversation);
    const element = fixture.nativeElement as HTMLElement;
    const posting = core.post("Shorten the second line.");
    theReply.says({
      kind: "entry",
      entry: entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    });
    theReply.says({ kind: "text", text: "I will shorten" });

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(element.querySelector("[data-part=replying]")).not.toBeNull();
    });
    const replying = element.querySelector("[data-part=replying]")?.closest("[data-entry]");
    expect(sideOf(replying)).toEqual({ right: false, width: "full" });
    const person = element.querySelectorAll("[data-entry]")[1];
    expect(sideOf(person)).toEqual({ right: true, width: "max-w-[70%]" });

    theReply.ends();
    await posting;
  });
});

/**
 * A notice under the `system` author (SL8, D34): what changed outside the conversation, as
 * one quiet line with no avatar, which the person has nothing to answer on.
 */
describe("a notice (D34)", () => {
  const notice =
    "Your profile was updated from your documents. Read it again before relying on it.";

  const withNotice = [
    entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
    entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
    entryOf(3, [{ kind: "notice", text: notice }], "system"),
  ];

  const expectOneQuietLine = (element: HTMLElement) => {
    const lines = Array.from(element.querySelectorAll("[data-part=notice]"));
    expect(lines.map(textOf)).toEqual([notice]);
    const entry = lines[0]?.closest("[data-entry]");
    expect(entry?.getAttribute("data-msg")).toBe("system");
    expect(lines[0]?.getAttribute("variant")).toBe("caption");
    expect(lines[0]?.getAttribute("tone")).toBe("muted");
    expect(entry?.querySelector("[data-part=avatar]")).toBeNull();
    expect(entry?.querySelector("button, input, textarea, a")).toBeNull();
    expect(textOf(element)).not.toContain("This part cannot be shown here.");
  };

  it("is an author the browser's entry type accepts", () => {
    const author: BrowserEntry["author"] = "system";
    expect(author).toBe("system");
  });

  it("draws a stored notice as one quiet line, in its place, after a reload", async () => {
    const element = await rendered(withNotice);

    expectOneQuietLine(element);
    const authors = Array.from(element.querySelectorAll("[data-entry]")).map((entry) =>
      entry.getAttribute("data-msg"),
    );
    expect(authors).toEqual(["assistant", "person", "system"]);
  });

  it("draws the notice when the conversation is next opened, with no reload", async () => {
    const element = await rendered(withNotice.slice(0, 2));
    expect(element.querySelectorAll("[data-part=notice]")).toHaveLength(0);

    conversationIs(withNotice);
    await TestBed.inject(AssistantCore).open();
    const fixture = TestBed.createComponent(AssistantConversation);
    await fixture.whenStable();

    expectOneQuietLine(fixture.nativeElement as HTMLElement);
  });

  it("opens no tool on a notice", async () => {
    const element = await rendered(withNotice, ColumnHost);

    expectOneQuietLine(element);
    expect(element.querySelector("[data-part=dock]")).toBeNull();
    expect(element.querySelector("tool-prefix")).toBeNull();
  });
});
