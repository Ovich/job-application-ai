import { env } from "../../env";
import { createAnswers } from "./answer";
import { defaultPace, paceFrom } from "./pace";

/**
 * The double's whole public face: two handlers and the listing of what it can answer
 * (`ID146`, `ID147`, `ID150`).
 *
 * A file that mounts it learns nothing about the answer documents, the loader, the two
 * serialisers, the chunking or the pacing clock — and nothing about a router, because
 * there is none: `routes/mock.ts` holds the paths, exactly as `routes/intake.ts` holds
 * the intake's.
 *
 * The configured pace is read here, at the edge where configuration is composed, and
 * handed to the handlers as a value: everything below this line takes what it needs as
 * arguments and reads no environment.
 */
const answers = createAnswers(paceFrom(env.AI_MOCK_PACE, defaultPace));

/** The OpenAI chat-completions answer, for whatever path a route file gives it. */
export const answerChatCompletions = answers.chatCompletions;

/** The same answers in Anthropic's envelope. */
export const answerMessages = answers.messages;

export { casesHeld, type RecordedCase, type RecordedCaseFile, withAnswersFrom } from "./answers";
export { chunksOf, defaultPace, intervalMs, type Pace, paceFrom, paceHeader, paceOf } from "./pace";
