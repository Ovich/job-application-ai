import type { MadeCall } from "./answers";

/**
 * A `Request` read once into what the mock answers from: the protocol's own body, the case
 * its header names, the last thing the user said, and the calls the model made since.
 *
 * The rest of a real provider's body is accepted and ignored.
 */

export type Protocol = "openai-chat" | "anthropic-messages";

export type Asked = {
  headers: Record<string, string>;
  body: unknown;
  model: string;
  /** The protocol's own `stream: true`. */
  stream: boolean;
  /** OpenAI's `stream_options.include_usage` (D29). */
  includeUsage: boolean;
  caseName: string | null;
  lastUserMessage: string | null;
  /** Each assistant message with calls after the last user message, its calls in order (D37). */
  callsSince: MadeCall[][];
};

/** What a body, a message or a block may hold, each key unread until it is checked. */
type Written = Partial<
  Record<
    | "model"
    | "stream"
    | "stream_options"
    | "include_usage"
    | "messages"
    | "role"
    | "content"
    | "type"
    | "text"
    | "tool_calls"
    | "function"
    | "name"
    | "arguments"
    | "input",
    unknown
  >
>;

const isRecord = (value: unknown): value is Written =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A message's text: the string itself, or its text blocks joined with nothing between
 * them, which is how both protocols spell content in parts.
 */
const textOf = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("");
};

/**
 * Whether a `user` message is the user's: Anthropic's protocol sends a call's result as a
 * `user` message of `tool_result` blocks, which nobody said.
 */
const isSaid = (message: unknown): message is Written =>
  isRecord(message) &&
  message.role === "user" &&
  !(
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((block) => isRecord(block) && block.type === "tool_result")
  );

/** An assistant message's calls, as either protocol writes them. */
const callsOf = (message: Written): MadeCall[] => {
  const calls: MadeCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (isRecord(call) && isRecord(call.function) && typeof call.function.name === "string") {
        calls.push({ name: call.function.name, arguments: call.function.arguments });
      }
    }
  }
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string") {
        calls.push({ name: block.name, arguments: block.input });
      }
    }
  }
  return calls;
};

/**
 * The last user message's text, or nothing: an earlier one is never looked at; and every
 * message of calls the model made after it.
 */
const conversationOf = (
  messages: unknown,
): { lastUserMessage: string | null; callsSince: MadeCall[][] } => {
  if (!Array.isArray(messages)) return { lastUserMessage: null, callsSince: [] };
  const at = messages.findLastIndex(isSaid);
  const last: unknown = messages[at];
  return {
    lastUserMessage: isRecord(last) ? textOf(last.content) : null,
    callsSince: messages
      .slice(at + 1)
      .flatMap((message: unknown) =>
        isRecord(message) && message.role === "assistant" ? [callsOf(message)] : [],
      )
      .filter((calls) => calls.length > 0),
  };
};

export const asked = async (request: Request, caseHeader: string): Promise<Asked> => {
  const body: unknown = await request.json().catch(() => ({}));
  const said = isRecord(body) ? body : {};
  const options = said.stream_options;
  return {
    headers: Object.fromEntries(request.headers),
    body,
    model: typeof said.model === "string" ? said.model : "mock-model",
    stream: said.stream === true,
    includeUsage: isRecord(options) && options.include_usage === true,
    caseName: request.headers.get(caseHeader),
    ...conversationOf(said.messages),
  };
};
