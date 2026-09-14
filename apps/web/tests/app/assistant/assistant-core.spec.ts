import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import {
  conversationIs,
  conversationRefused,
  entryOf,
  intakeRequests,
  resetIntake,
} from "../../support/intake";
import { reset } from "../../support/session";

/**
 * Seam W: `AssistantCore`, provided the way a screen provides it (`S2.3`, `ID183`,
 * `ID186`).
 *
 * Behind it: the RPC client, stood in for at `fetch` with an answer per case
 * (`tests/support/intake.ts`). What is read is the core's signals, which is what a
 * screen binds to.
 *
 * Not past it: the component that draws the entries, which has its own file.
 */

beforeEach(() => {
  reset();
  resetIntake();
});

afterEach(() => {
  reset();
  resetIntake();
});

const coreOf = (name: string): AssistantCore => {
  TestBed.configureTestingModule({ providers: provideAssistant({ name, parts: [] }) });
  return TestBed.inject(AssistantCore);
};

describe("opening the conversation", () => {
  it("holds the entries the conversation answered, and no failure", async () => {
    const opening = entryOf(1, [{ kind: "text", text: "I read your 2 documents." }]);
    conversationIs([opening]);
    const core = coreOf("profile");

    await core.open();

    expect(core.entries()).toEqual([opening]);
    expect(core.failure()).toBeNull();
    expect(core.replying()).toBeNull();
  });

  it("asks for the assistant the ASSISTANT token names, never one written in the core (ID186)", async () => {
    conversationIs([entryOf(1, [{ kind: "text", text: "Hello." }])]);
    const core = coreOf("cover-letter");

    await core.open();

    expect(intakeRequests()).toEqual([
      { method: "GET", address: "/api/conversations/cover-letter" },
    ]);
  });

  it("says what the route refused with, and holds no entries, when nobody is signed in", async () => {
    conversationRefused(401, { error: "sign in first" });
    const core = coreOf("profile");

    await core.open();

    expect(core.failure()).toBe("sign in first");
    expect(core.entries()).toEqual([]);
  });
});
