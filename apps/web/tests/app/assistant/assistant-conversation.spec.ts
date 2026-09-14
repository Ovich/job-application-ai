import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantConversation } from "../../../src/app/assistant/assistant-conversation/assistant-conversation";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import { CurrentUser } from "../../../src/app/auth/current-user";
import { conversationIs, type Entry, entryOf, resetIntake, theReply } from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

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
  TestBed.configureTestingModule({ providers: provideAssistant({ name: "profile", parts: [] }) });
});

afterEach(() => {
  reset();
  resetIntake();
});

const rendered = async (entries: Entry[]) => {
  conversationIs(entries);
  await TestBed.inject(AssistantCore).open();
  const fixture = TestBed.createComponent(AssistantConversation);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

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
