import { InjectionToken, type Provider, type Type } from "@angular/core";
import { AssistantCore } from "./assistant-core";

/**
 * How a screen gets an assistant (`ID186`): the Angular idiom of `provideRouter`.
 *
 * **The core is extended by contribution, never by inheritance.** A concrete assistant
 * is what a screen puts in its `providers` — its name, and the component that draws each
 * part of its own — and nothing under `app/assistant/` names one. Each screen gets its own
 * `AssistantCore`, so two conversations on one page are two instances and nothing is
 * kept in root (`ID183`).
 */

/** Which assistant this is: the `:assistant` the core asks the API for. */
export const ASSISTANT = new InjectionToken<{ name: string }>("the assistant");

/** One part a concrete assistant draws itself, by the part's kind. */
export type AssistantPart = { kind: string; component: Type<unknown> };

/**
 * Every part the assistant draws itself, one `multi` provider each (`ID185`). Declared
 * here because `provideAssistant` returns its providers; no assistant provides one before
 * `SL4`, and a kind nobody provides is drawn as a placeholder.
 */
export const ASSISTANT_PARTS = new InjectionToken<AssistantPart[]>("the assistant's parts");

export const provideAssistant = (assistant: {
  name: string;
  parts: AssistantPart[];
}): Provider[] => [
  { provide: ASSISTANT, useValue: { name: assistant.name } },
  ...assistant.parts.map((part) => ({ provide: ASSISTANT_PARTS, useValue: part, multi: true })),
  AssistantCore,
];
