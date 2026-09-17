import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantCore } from "../../../../src/app/assistant/assistant-core";
import { HistoryReadPart } from "../../../../src/app/profile/profile-assistant/history/history-read-part/history-read-part";
import { ProfileAssistant } from "../../../../src/app/profile/profile-assistant/profile-assistant";
import {
  conversationIs,
  type Entry,
  entryOf,
  resetIntake,
  resetReplies,
  theReply,
} from "../../../support/intake";
import { reset } from "../../../support/session";

/**
 * Seam E: the profile read's part component, rendered (`ID301`, D33): a stored read is
 * one quiet line saying what was read, never the JSON the agent was handed, whether it
 * arrives live in a reply or is drawn again after a reload.
 *
 * Behind it: the part it is handed, as a stored `tool_result` of `read_profile` holds it,
 * and for the conversation cases the `AssistantCore` the screen provides, answered by the
 * RPC client stood in for (`tests/support/intake.ts`).
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

type Part = Entry["parts"][number];

/** An item as `read_profile` answers it. */
const post = {
  id: "item-nexplore",
  kind: "experience",
  title: "Platform engineer",
  subtitle: null,
  startText: "Feb 2021",
  endText: "Dec 2024",
  block: { organisation: "Nexplore", organisationNote: null, location: null, arrangement: null },
  lines: [{ id: "line-1", text: "Ran the services on Kubernetes." }],
  children: [],
  concerns: [{ kind: "scope", text: "Kubernetes: shipping only", source: "answer" }],
};

const readOf = (read: Record<string, unknown>): Part => ({
  kind: "tool_result",
  id: "call_read",
  name: "read_profile",
  read,
});

const theCall: Part = { kind: "tool_use", id: "call_read", name: "read_profile", input: {} };

beforeEach(() => {
  reset();
  resetIntake();
  resetReplies();
});

afterEach(() => {
  reset();
  resetIntake();
  resetReplies();
});

const drawn = async (part: Part): Promise<HTMLElement> => {
  const fixture = TestBed.createComponent(HistoryReadPart);
  fixture.componentRef.setInput("part", part);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe("a read, as one line (ID301)", () => {
  it.each([
    ["the whole profile", "Read your profile", { items: [post] }],
    ["one kind", "Read: Experience", { kind: "experience", items: [post] }],
    ["another kind", "Read: Projects", { kind: "project", items: [] }],
    ["one item", "Read: Platform engineer", { itemId: "item-nexplore", items: [post] }],
  ])("draws a read of %s as `%s`", async (_what, line, read) => {
    const element = await drawn(readOf(read));

    expect(element.querySelectorAll("[data-part=read]")).toHaveLength(1);
    expect(textOf(element)).toBe(line);
  });

  it("never draws what was read", async () => {
    const element = await drawn(readOf({ items: [post] }));

    expect(textOf(element)).not.toContain("Ran the services");
    expect(textOf(element)).not.toContain("{");
  });
});

describe("in the conversation, drawn by the profile assistant's #part template (D33)", () => {
  /** The column as it stands, once `text` is drawn in it. */
  const columnShowing = async (text: string) => {
    const fixture = TestBed.createComponent(ProfileAssistant);
    const element = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(textOf(element)).toContain(text);
    });
    return { fixture, element };
  };

  const expectOneReadLine = (element: HTMLElement, line: string) => {
    expect(Array.from(element.querySelectorAll("[data-part=read]")).map(textOf)).toEqual([line]);
    expect(textOf(element)).not.toContain("Ran the services");
    expect(textOf(element)).not.toContain("item-nexplore");
    expect(textOf(element)).not.toContain("This part cannot be shown here.");
    expect(element.querySelectorAll("[data-part=record]")).toHaveLength(0);
  };

  it("draws a stored read as one line after a reload, and its call as nothing", async () => {
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
      entryOf(2, [{ kind: "text", text: "What do you know of me?" }], "person"),
      entryOf(3, [theCall]),
      entryOf(4, [readOf({ items: [post] })], "tool"),
      entryOf(5, [{ kind: "text", text: "One post, at Nexplore." }]),
    ]);

    const { element } = await columnShowing("One post, at Nexplore.");

    expectOneReadLine(element, "Read your profile");
  });

  it("draws a read arriving in a reply as the same one line", async () => {
    conversationIs([
      entryOf(1, [{ kind: "text", text: "I read your 2 documents.", scripted: true }]),
    ]);
    const { fixture, element } = await columnShowing("I read your 2 documents.");
    const core = fixture.debugElement.injector.get(AssistantCore);

    const posting = core.post("What is under Experience?");
    theReply.says({
      kind: "entry",
      entry: entryOf(2, [{ kind: "text", text: "What is under Experience?" }], "person"),
    });
    theReply.says({ kind: "status", text: "Reading: Experience" });
    theReply.says({ kind: "entry", entry: entryOf(3, [theCall]) });
    theReply.says({
      kind: "entry",
      entry: entryOf(4, [readOf({ kind: "experience", items: [post] })], "tool"),
    });
    theReply.says({
      kind: "entry",
      entry: entryOf(5, [{ kind: "text", text: "One post, at Nexplore." }]),
    });
    theReply.says({ kind: "done" });
    theReply.ends();
    await posting;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(textOf(element)).toContain("One post, at Nexplore.");
    });

    expectOneReadLine(element, "Read: Experience");
  });
});
