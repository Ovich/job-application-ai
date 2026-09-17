/**
 * A `Request` read once into what the mock answers from: the protocol's own body, the case
 * its header names, and the last thing the user said.
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
    | "text",
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

/** The last `user` message's text, or nothing: an earlier one is never looked at. */
const lastUserMessageOf = (messages: unknown): string | null => {
  if (!Array.isArray(messages)) return null;
  const last = messages.findLast((message) => isRecord(message) && message.role === "user");
  return isRecord(last) ? textOf(last.content) : null;
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
    lastUserMessage: lastUserMessageOf(said.messages),
  };
};
