import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantConversation } from "../../../src/app/assistant/assistant-conversation/assistant-conversation";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import { conversationIs, type Entry, entryOf, resetIntake } from "../../support/intake";
import { reset } from "../../support/session";

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
