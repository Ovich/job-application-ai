import { Injectable, inject, signal } from "@angular/core";
import type { InferResponseType } from "hono/client";
import { api } from "../lib/api";
import { framesOf } from "../lib/stream";
import { ASSISTANT } from "./provide-assistant";

type Conversation = InferResponseType<(typeof api.conversations)[":assistant"]["$get"], 200>;

/** One entry as the API answers it: inferred from `AppType`, never declared here. */
export type Entry = Conversation["entries"][number];

/** What a message's stream says, as far as the core reads it (`ID170`). */
type Leaf =
  | { kind: "entry"; entry: Entry }
  | { kind: "status"; text: string }
  | { kind: "text"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * One conversation, held for one screen (`ID183`): the only code in the web app that
 * calls `api.conversations`.
 *
 * **It knows no use case.** Which assistant it is comes from the `ASSISTANT` token the
 * screen provided through `provideAssistant`, and a screen gets its own instance, so
 * nothing is kept in root. It holds signals, as `CurrentUser` does, and a template
 * reaches none of them directly (`AGENTS.md` 3): the component that provides it exposes
 * what it binds to.
 */
@Injectable()
export class AssistantCore {
  private readonly assistant = inject(ASSISTANT);

  private readonly held = signal<Entry[]>([]);

  private readonly streamed = signal<string | null>(null);

  private readonly refused = signal<string | null>(null);

  private subject: string | undefined;

  /** Whether a message is on its way, from the moment it is posted until its stream ends. */
  private posting = false;

  /** Every entry of the conversation, in order, as it was stored. */
  public readonly entries = this.held.asReadonly();

  /** The reply's text so far, or `null` when none is streaming. */
  public readonly replying = this.streamed.asReadonly();

  /** One sentence saying what went wrong, or `null` while nothing has. */
  public readonly failure = this.refused.asReadonly();

  private readonly doing = signal<string | null>(null);

  /**
   * What the agent is doing now, in a few words, or `null` (`ID210`, spec `H27`): set by a
   * status frame, cleared by the reply's first words, an entry or the stream's end.
   */
  public readonly activity = this.doing.asReadonly();

  /**
   * Says what the assistant is doing while the use case works on its behalf, or nothing
   * (`ID217`): a decision being saved has no stream to say it. A message posted after it
   * still sets and clears `activity` from its own stream, whatever was shown before.
   */
  public showActivity(phrase: string | null): void {
    this.doing.set(phrase);
  }

  /** Opens this assistant's conversation, about a subject or none, creating it if absent. */
  public async open(subject?: string): Promise<void> {
    this.subject = subject;
    await this.reload();
  }

  /** Reads the conversation again, as it now stands. */
  public async reload(): Promise<void> {
    try {
      const answer = await api.conversations[":assistant"].$get({
        param: { assistant: this.assistant.name },
        query: this.subject === undefined ? {} : { subject: this.subject },
      });
      if (answer.ok) {
        this.held.set((await answer.json()).entries);
        this.refused.set(null);
        return;
      }
      const said: { error?: string } = await answer.json();
      this.held.set([]);
      this.refused.set(said.error ?? "the conversation could not be opened");
    } catch {
      this.held.set([]);
      this.refused.set("the conversation could not be reached");
    }
  }

  /**
   * Something the person did with the concrete assistant's tool, not a message (D9): the
   * action named, run by the API with its input in one transaction. The entries it answers
   * join `entries`, and it resolves `true` when kept and `false` when refused or unreachable.
   *
   * **A refusal writes no `failure`** (D19): today's column says a decision was not kept in
   * its own words, beside the tool, and draws no failure line under the conversation.
   */
  public async act(action: string, input: unknown): Promise<boolean> {
    try {
      const answer = await api.conversations[":assistant"].actions[":action"].$post({
        param: { assistant: this.assistant.name, action },
        json: input,
      });
      if (!answer.ok) return false;
      const kept = (await answer.json()) as { entries: Entry[] };
      this.held.update((entries) => [...entries, ...kept.entries]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A free message (`US2`): posted, and the stream read as it arrives. Each entry frame
   * is an entry the API has committed, so it joins `entries`; each text frame grows
   * `replying`; an error frame sets `failure` and keeps the person's entry. Resolves when
   * the stream ends, done or error.
   *
   * **A post while one is on its way is refused and sends nothing.**
   *
   * With `about`, the words are about an item of the profile or one of its lines
   * (agent-consolidation `S8.7`, `ID233`): the API names where it is and stores it with them.
   */
  public async post(text: string, about?: { itemId: string; lineId?: string }): Promise<void> {
    if (this.posting) return;
    this.posting = true;
    this.refused.set(null);
    try {
      const answer = await api.conversations[":assistant"].messages.$post({
        param: { assistant: this.assistant.name },
        json: {
          text,
          ...(this.subject === undefined ? {} : { subject: this.subject }),
          ...(about === undefined ? {} : { about }),
        },
      });
      if (!answer.ok || answer.body === null) {
        const said = (await answer.json().catch(() => ({}))) as { error?: string };
        this.refused.set(said.error ?? "the message could not be sent");
        return;
      }
      for await (const frame of framesOf(answer.body)) {
        const leaf = frame.leaf as Leaf;
        this.doing.set(leaf.kind === "status" ? leaf.text : null);
        if (leaf.kind === "entry") this.held.update((entries) => [...entries, leaf.entry]);
        if (leaf.kind === "text") this.streamed.update((so) => (so ?? "") + leaf.text);
        if (leaf.kind === "error") this.refused.set(leaf.message);
        if (leaf.kind === "entry" && leaf.entry.author !== "person") this.streamed.set(null);
      }
    } catch {
      this.refused.set("the message could not be sent");
    } finally {
      this.streamed.set(null);
      this.doing.set(null);
      this.posting = false;
    }
  }
}
