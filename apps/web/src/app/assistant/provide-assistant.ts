import { InjectionToken, type Provider } from "@angular/core";
import { AssistantCore } from "./assistant-core";

/**
 * How a screen gets an assistant (`ID186`): the Angular idiom of `provideRouter`.
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant
 * puts its name in its own `providers`, and draws every part of its own through the
 * `#part` template it gives the conversation (D4); nothing under `app/assistant/` names
 * one. Each screen gets its own `AssistantCore`, so two conversations on one page are two
 * instances and nothing is kept in root (`ID183`).
 */

/** Which assistant this is: the `:assistant` the core asks the API for. */
export const ASSISTANT = new InjectionToken<{ name: string }>("the assistant");

export const provideAssistant = (assistant: { name: string }): Provider[] => [
  { provide: ASSISTANT, useValue: { name: assistant.name } },
  AssistantCore,
];
