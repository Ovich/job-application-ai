import type { InferResponseType } from "hono/client";
import type { api } from "../lib/api";

type Conversation = InferResponseType<(typeof api.conversations)[":assistant"]["$get"], 200>;

/**
 * One entry as the API answers it: inferred from `AppType`, never declared here. A module of
 * its own (`ID249`), because the concrete assistant's history parts read it too.
 */
export type Entry = Conversation["entries"][number];
