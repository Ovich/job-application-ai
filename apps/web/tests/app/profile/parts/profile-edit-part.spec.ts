import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantConversation } from "../../../../src/app/assistant/assistant-conversation/assistant-conversation";
import { AssistantCore } from "../../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../../src/app/assistant/provide-assistant";
import { ProfileEditPart } from "../../../../src/app/profile/parts/profile-edit-part/profile-edit-part";
import { conversationIs, type Entry, entryOf, resetIntake } from "../../../support/intake";
import { reset } from "../../../support/session";

/**
 * Seam E: the profile edit's part component, rendered (`S4.6`, `US2`, `ID185`, `ID191`,
 * the spec's *Failure modes*).
 *
 * Behind it: the part it is handed, as a stored `tool_result` or `tool_use` holds it, and
 * for the last cases the `AssistantCore` a screen provides, holding entries answered by
 * the RPC client stood in for (`tests/support/intake.ts`). No `fetch` is stubbed here.
 *
 * Not past it: the component's fields. What is asserted is the text a person reads, and
 * which of it is the before and which the after. The look is the person's design review.
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const textsOf = (element: HTMLElement, selector: string): string[] =>
  Array.from(element.querySelectorAll(selector)).map((each) => textOf(each));

type Part = Entry["parts"][number];

/** The post as `lib/profile-edit` answers an item. */
const post = {
  id: "item-nexplore",
  kind: "experience",
  title: "Platform engineer",
  subtitle: null,
  startText: "Feb 2021",
  endText: "Dec 2024",
  block: {
    organisation: "Nexplore",
    organisationNote: null,
    location: "Zurich",
    arrangement: null,
  },
  lines: [
    { id: "line-1", text: "Ran the services on Kubernetes." },
    { id: "line-2", text: "Designed and shipped the internal developer platform." },
  ],
  children: [{ id: "item-portal", kind: "project", title: "Developer portal" }],
};

const applied = (after: Record<string, unknown>): Part => ({
  kind: "tool_result",
  id: "call_1",
  name: "edit_profile",
  before: post,
  after: { ...post, ...after },
});

beforeEach(() => {
  reset();
  resetIntake();
});

afterEach(() => {
  reset();
  resetIntake();
});

const drawn = async (part: Part): Promise<HTMLElement> => {
  const fixture = TestBed.createComponent(ProfileEditPart);
  fixture.componentRef.setInput("part", part);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe("an applied edit (S4.6, US2)", () => {
  it("draws a replaced line's before and after, under the item's name", async () => {
    const element = await drawn(
      applied({
        lines: [post.lines[0], { id: "line-2", text: "Shipped the developer platform." }],
      }),
    );

    expect(textOf(element)).toContain("Platform engineer");
    expect(textsOf(element, "[data-part=was]")).toEqual([
      "Designed and shipped the internal developer platform.",
    ]);
    expect(textsOf(element, "[data-part=now]")).toEqual(["Shipped the developer platform."]);
    expect(textsOf(element, "[data-part=refused]")).toEqual([]);
  });

  it("draws a field's before and after", async () => {
    const element = await drawn(
      applied({
        title: "Senior platform engineer",
        block: { ...post.block, location: "Lausanne" },
      }),
    );

    expect(textsOf(element, "[data-part=was]")).toEqual(["Platform engineer", "Zurich"]);
    expect(textsOf(element, "[data-part=now]")).toEqual(["Senior platform engineer", "Lausanne"]);
  });

  it("draws an added line as an after alone, and a removed line and child as a before alone", async () => {
    const element = await drawn(
      applied({
        lines: [
          { id: "line-2", text: "Designed and shipped the internal developer platform." },
          { id: "line-3", text: "Led the move to Kubernetes." },
        ],
        children: [],
      }),
    );

    expect(textsOf(element, "[data-part=was]")).toEqual([
      "Ran the services on Kubernetes.",
      "Developer portal",
    ]);
    expect(textsOf(element, "[data-part=now]")).toEqual(["Led the move to Kubernetes."]);
  });
});

describe("a refused edit (the spec's Failure modes)", () => {
  it("draws the reason, and no before and after", async () => {
    const element = await drawn({
      kind: "tool_result",
      id: "call_1",
      name: "edit_profile",
      refused:
        "The line line-9 no longer exists on this item; the profile may have changed, so reload it.",
    });

    expect(textOf(element)).toContain(
      "The line line-9 no longer exists on this item; the profile may have changed, so reload it.",
    );
    expect(textsOf(element, "[data-part=was]")).toEqual([]);
    expect(textsOf(element, "[data-part=now]")).toEqual([]);
  });
});

describe("the call itself", () => {
  it("draws nothing for a tool_use: the record below it says what it did", async () => {
    const element = await drawn({
      kind: "tool_use",
      id: "call_1",
      name: "edit_profile",
      input: { itemId: "item-nexplore", operations: [] },
    });

    expect(textOf(element)).toBe("");
  });
});

describe("in the conversation, provided as the profile's parts (ID185)", () => {
  it("draws the record of a stored edit, and no placeholder for its call or its result", async () => {
    TestBed.configureTestingModule({
      providers: provideAssistant({
        name: "profile",
        parts: [
          { kind: "tool_use", component: ProfileEditPart },
          { kind: "tool_result", component: ProfileEditPart },
        ],
      }),
    });
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "Shorten the second line." }], "person"),
      entryOf(3, [
        { kind: "text", text: "I will shorten the second line." },
        { kind: "tool_use", id: "call_1", name: "edit_profile", input: {} },
      ]),
      entryOf(
        4,
        [
          applied({
            lines: [post.lines[0], { id: "line-2", text: "Shipped the developer platform." }],
          }),
        ],
        "tool",
      ),
    ]);
    await TestBed.inject(AssistantCore).open();
    const fixture = TestBed.createComponent(AssistantConversation);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(textOf(element)).toContain("I will shorten the second line.");
    expect(textsOf(element, "[data-part=now]")).toEqual(["Shipped the developer platform."]);
    expect(textOf(element)).not.toContain("This part cannot be shown here.");
  });
});
