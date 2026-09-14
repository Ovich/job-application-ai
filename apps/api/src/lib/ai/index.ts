import { env } from "../../env";
import { createAi } from "./client";
import { answeringOwnAddress } from "./own-address";

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

/**
 * What answers a call to this application's own address, handed over by the composition
 * root rather than reached for from here.
 *
 * It is a value the application gives this module, and not an import: this module is
 * reached by the very steps the application is assembled from, so asking for the
 * application by name here would be a cycle. `app.ts` hands it over once it is built,
 * which is the same order every runtime already has — the entry point loads the
 * application, and the application is what a call can be given back to.
 */
let answersItself: ((request: Request) => Promise<Response>) | undefined;

/** Hands this module the application that answers its own address (`ID130`, `ID150`). */
export const answeredInProcessBy = (answer: (request: Request) => Promise<Response>): void => {
  answersItself = answer;
};

const ai = createAi({
  baseUrl: env.AI_BASE_URL,
  apiKey: env.AI_API_KEY,
  model: env.AI_MODEL,
  // Where the deployed function answers itself (`ID130`, `ID150`).
  fetch: answeringOwnAddress({
    origin: new URL(env.APP_URL).origin,
    answer: (request) => {
      if (answersItself === undefined) {
        throw new Error(
          "no answerer was handed to lib/ai: the composition root calls answeredInProcessBy",
        );
      }
      return answersItself(request);
    },
    otherwise: (input, init) => fetch(input, init),
  }),
});

/** A whole answer, as text. */
export const ask = ai.ask;

/** The same answer in pieces, as the protocol's own `stream: true` delivers them. */
export const askStreaming = ai.askStreaming;

/** The answer parsed into the shape the step asked for, or an error. Never half of one. */
export const askFor = ai.askFor;

/** A step that may call the tools offered: its text in pieces, then its calls. */
export const askWithTools = ai.askWithTools;

export {
  type About,
  type Ai,
  type AiConfig,
  createAi,
  type Message,
  type Step,
  type Tool,
  type ToolCall,
} from "./client";
export { answeringOwnAddress, type Fetch, type OwnAddress } from "./own-address";
