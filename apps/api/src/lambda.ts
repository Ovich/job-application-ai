import { streamHandle } from "hono/aws-lambda";
import { app } from "./app";

/**
 * The cloud entry point: the same application the laptop serves, behind the Lambda
 * runtime. Wiring only (ID7), and the one file in the API that knows it is on AWS.
 *
 * `streamHandle` rather than the buffered `handle`, because the function URL is in
 * response-streaming invoke mode. Streaming mode serves an ordinary JSON response
 * perfectly well, so this is the entry point for every route and the API is never split
 * into a streaming function and a buffered one (F6, ID9).
 */
export const handler = streamHandle(app);
