import { Injectable, inject, signal } from "@angular/core";
import type { InferResponseType } from "hono/client";
import { api } from "../lib/api";
import { ASSISTANT } from "./provide-assistant";

type Conversation = InferResponseType<(typeof api.conversations)[":assistant"]["$get"], 200>;

/** One entry as the API answers it: inferred from `AppType`, never declared here. */
export type Entry = Conversation["entries"][number];

/**
 * One conversation, held for one screen (`ID183`): the only code in the web app that
 * calls `api.conversations`.
 *
 * **It knows no use case.** Which assistant it is comes from the `ASSISTANT` token the
 * screen provided through `provideAssistant`, and a screen gets its own instance, so
 * nothing is kept in root. It holds signals, as `CurrentUser` does, and a template
 * reaches none of them directly (`AGENTS.md` 3): the component that provides it exposes
 * what it binds to.
 *
 * `replying` is the reply streamed so far; nothing is posted before `SL3`, so it is
 * always `null` here.
 */
@Injectable()
export class AssistantCore {
  private readonly assistant = inject(ASSISTANT);

  private readonly held = signal<Entry[]>([]);

  private readonly streamed = signal<string | null>(null);

  private readonly refused = signal<string | null>(null);

  private subject: string | undefined;

  /** Every entry of the conversation, in order, as it was stored. */
  public readonly entries = this.held.asReadonly();

  public readonly replying = this.streamed.asReadonly();

  /** What the route refused with, or `null` while nothing has gone wrong. */
  public readonly failure = this.refused.asReadonly();

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
}
