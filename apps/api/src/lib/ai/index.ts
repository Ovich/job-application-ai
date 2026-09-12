import { env } from "../../env";
import { createAi } from "./client";

/**
 * The AI boundary, configured. This file is the module's whole public face: a pipeline
 * step writes `from "../lib/ai"` and learns nothing about the client, the base URL, the
 * key, the model or the header the call's metadata travels in.
 *
 * The instance is built from `env.ts`, the one reader of the process environment, and
 * the values reach it as arguments. `createAi` is exported beside it for the callers
 * that must configure their own — the suite, and the deployed function that answers
 * itself in process (`ID130`, `ID150`).
 */

const ai = createAi({
  baseUrl: env.AI_BASE_URL,
  apiKey: env.AI_API_KEY,
  model: env.AI_MODEL,
});

/** A whole answer, as text. */
export const ask = ai.ask;

/** The same answer in pieces, as the protocol's own `stream: true` delivers them. */
export const askStreaming = ai.askStreaming;

/** The answer parsed into the shape the step asked for, or an error. Never half of one. */
export const askFor = ai.askFor;

export { type About, type Ai, type AiConfig, createAi, type Message } from "./client";
