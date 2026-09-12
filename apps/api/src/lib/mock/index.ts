import { env } from "../../../env";
import { defaultPace, paceFrom } from "./pace";
import { createMockRouter } from "./router";

/**
 * The mock's whole public face. `app.ts` mounts `mock` and learns nothing about the
 * fixture tree, the loader, the two serialisers, the chunking or the pacing clock.
 *
 * The configured pace is read here, at the edge where configuration is composed, and
 * handed to the router as a value: everything below this line takes what it needs as
 * arguments.
 */
export const mock = createMockRouter(paceFrom(env.AI_MOCK_PACE, defaultPace));

export { casesHeld, type RecordedCase, type RecordedCaseFile, useFixtureRoot } from "./fixtures";
export { chunksOf, defaultPace, intervalMs, type Pace, paceFrom, paceHeader, paceOf } from "./pace";
