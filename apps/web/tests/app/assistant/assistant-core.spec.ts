import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantCore } from "../../../src/app/assistant/assistant-core";
import { provideAssistant } from "../../../src/app/assistant/provide-assistant";
import {
  conversationIs,
  conversationRefused,
  entryOf,
  intakeRequests,
  messagesPosted,
  profileIs,
  questionOf,
  resetIntake,
  theReply,
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
  TestBed.configureTestingModule({ providers: provideAssistant({ name }) });
  return TestBed.inject(AssistantCore);
};

/**
 * Seam W: what the person did with the concrete assistant's own tool, as an action (D9,
 * `ID263`). The action route is stood in for at `fetch` with the profile it acts on.
 */
describe("acting through the assistant's tool (D9)", () => {
  const opening = entryOf(1, [{ kind: "text", text: "I read your 2 documents." }]);
  const asked = questionOf({ id: "q1", itemId: "k8s", lead: "Which was it?" });

  it("appends the entries the action answered, and resolves true", async () => {
    profileIs({ documents: 2, questions: [asked] });
    conversationIs([opening]);
    const core = coreOf("profile");
    await core.open();

    const kept = await core.act("skip_question", { questionId: "q1" });

    expect(kept).toBe(true);
    expect(core.entries()).toEqual([
      opening,
      expect.objectContaining({
        author: "person",
        parts: [expect.objectContaining({ kind: "question_skipped", lead: "Which was it?" })],
      }),
    ]);
    expect(intakeRequests()).toContainEqual({
      method: "POST",
      address: "/api/conversations/profile/actions/skip_question",
    });
  });

  it("resolves false on a refusal, keeps the entries as they were, and sets no failure (ID263)", async () => {
    profileIs({ documents: 2, questions: [asked] });
    conversationIs([opening]);
    const core = coreOf("profile");
    await core.open();

    const kept = await core.act("answer_question", { questionId: "a-question-nobody-asked" });

    expect(kept).toBe(false);
    expect(core.entries()).toEqual([opening]);
    expect(core.failure()).toBeNull();
  });
});

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

/**
 * Seam B: what the assistant shows it is doing while a use case works on its behalf
 * (agent-consolidation `S8.3`, `ID217`): a decision being saved has no stream of its own,
 * so the use case says it.
 */
describe("showing an activity (S8.3, ID217)", () => {
  const opening = entryOf(1, [{ kind: "text", text: "I read your 2 documents." }]);

  it("reads the phrase shown, and nothing once it is taken away", async () => {
    conversationIs([opening]);
    const core = coreOf("profile");
    await core.open();

    core.showActivity("Thinking");
    expect(core.activity()).toBe("Thinking");

    core.showActivity(null);
    expect(core.activity()).toBeNull();
  });

  it("still takes a message's status frames after it, and its end clears them (ID210)", async () => {
    conversationIs([opening]);
    const core = coreOf("profile");
    await core.open();
    core.showActivity("Thinking");

    const posting = core.post("I ran the services.");
    theReply.says({ kind: "status", text: "Reading your profile" });
    await vi.waitFor(() => expect(core.activity()).toBe("Reading your profile"));
    theReply.says({ kind: "done" });
    theReply.ends();
    await posting;

    expect(core.activity()).toBeNull();
  });
});

/** Seam D: a free message, as a component reads the core (`SL3`, `US2`, `ID183`). */
describe("posting a free message (SL3)", () => {
  const opening = entryOf(1, [{ kind: "text", text: "I read your 2 documents." }]);
  const mine = entryOf(2, [{ kind: "text", text: "I ran the services." }], "person");
  const theirs = entryOf(3, [{ kind: "text", text: "No pre generated text" }]);

  const opened = async (): Promise<AssistantCore> => {
    conversationIs([opening]);
    const core = coreOf("profile");
    await core.open();
    return core;
  };

  it("holds the person's entry at its frame, grows the reply per text frame, and holds both at done", async () => {
    const core = await opened();

    const posting = core.post("I ran the services.");
    theReply.says({ kind: "entry", entry: mine });
    await vi.waitFor(() => expect(core.entries()).toEqual([opening, mine]));
    theReply.says({ kind: "text", text: "No pre" });
    await vi.waitFor(() => expect(core.replying()).toBe("No pre"));
    theReply.says({ kind: "text", text: " generated text" });
    await vi.waitFor(() => expect(core.replying()).toBe("No pre generated text"));
    theReply.says({ kind: "entry", entry: theirs });
    theReply.says({ kind: "done" });
    theReply.ends();
    await posting;

    expect(messagesPosted()).toEqual([
      { address: "/api/conversations/profile/messages", text: "I ran the services." },
    ]);
    expect(core.replying()).toBeNull();
    expect(core.entries()).toEqual([opening, mine, theirs]);
    expect(core.failure()).toBeNull();
  });

  it("sets the failure, clears the reply and keeps the person's entry on an error frame", async () => {
    const core = await opened();

    const posting = core.post("I ran the services.");
    theReply.says({ kind: "entry", entry: mine });
    theReply.says({ kind: "text", text: "No pre" });
    theReply.says({ kind: "error", message: "The assistant could not answer this time." });
    theReply.ends();
    await posting;

    expect(core.failure()).toBe("The assistant could not answer this time.");
    expect(core.replying()).toBeNull();
    expect(core.entries()).toEqual([opening, mine]);
  });

  it("posts what the words are about beside them, when the screen says (S8.7, ID233)", async () => {
    const core = await opened();
    // The screen's call, as `ProfileViewer.clarified` makes it: the words and what they are about.
    const post: (text: string, about: { itemId: string; lineId?: string }) => Promise<void> =
      core.post.bind(core);

    const posting = post("I ran the services.", { itemId: "post-heig", lineId: "line-2" });
    theReply.says({ kind: "done" });
    theReply.ends();
    await posting;

    expect(messagesPosted()).toEqual([
      {
        address: "/api/conversations/profile/messages",
        text: "I ran the services.",
        about: { itemId: "post-heig", lineId: "line-2" },
      },
    ]);
  });

  it("refuses a second post while a reply streams, and sends nothing", async () => {
    const core = await opened();

    const posting = core.post("I ran the services.");
    theReply.says({ kind: "entry", entry: mine });
    theReply.says({ kind: "text", text: "No pre" });
    await vi.waitFor(() => expect(core.replying()).toBe("No pre"));

    await core.post("And a second thing.");

    expect(messagesPosted()).toHaveLength(1);
    theReply.says({ kind: "done" });
    theReply.ends();
    await posting;
  });
});
