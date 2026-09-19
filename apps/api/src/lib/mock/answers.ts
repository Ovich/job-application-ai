import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The answers, from a folder or inline: what one is, how it is validated, what its id is,
 * and how a request finds one (`ID292`, `ID295`).
 *
 * **Nothing in an answer names a protocol.** It holds the content once and the two
 * serialisers wrap it (`D11`): the day a provider is reached in the other shape, the
 * answers do not move.
 *
 * This module reads files and nothing else. It imports no client and can open no
 * connection, which is what makes a miss a failure rather than a call (spec `D20`).
 */

/**
 * One answer: a file's content, or an inline value. `content` is required unless the
 * answer calls a tool.
 */
export type Answer = {
  content?: string;
  /** The exact last user message this replies to. */
  answers?: string;
  /** An exact name a request's case header may ask for. */
  case?: string;
  /**
   * The step's calls, in a shape no protocol owns (`ID190`). `arguments` is what the model
   * passed, an object as a rule; a string is sent as the protocol's own text, verbatim,
   * which is how an answer holds arguments that do not parse.
   */
  tool_calls?: { name: string; arguments: unknown; id?: string }[];
  /** The counts, in envelope-independent names: each serialiser maps them to its own. */
  usage?: { input_tokens: number; output_tokens: number };
  /**
   * What this answer says back out of the request it answers (`ID316`): a name for each
   * regular expression, with one capture group, run against the request's last user
   * message. `{{name}}` anywhere in `content` is replaced by what that name captured.
   *
   * It is "say back something the request said" and nothing more: this module knows no
   * schema and no product, and what a capture means is the author's business.
   */
  quoting?: Record<string, string>;
  /**
   * What answers the message after this answer's calls were made (`D37`): the next link of
   * a chain, found by walking, never by an `answers` or a `case` of its own.
   */
  next?: Omit<Answer, "answers" | "case">;
};

/** An answer as the serialisers take it: every optional part filled in. */
export type Held = {
  /** Its `case` when written, else where it came from: a path without its extension, or an index. */
  id: string;
  /** What an error names it by: the file's path, or `answer <index>`. */
  from: string;
  case: string | undefined;
  answers: string | undefined;
  content: string;
  tool_calls: { id: string; name: string; arguments: unknown }[];
  usage: { input_tokens: number; output_tokens: number };
  /** The expressions this answer quotes the request by, compiled, empty when it quotes nothing. */
  quoting: Map<string, RegExp>;
  /** The next link of the chain, when the answer has one. */
  next: Held | undefined;
};

/** What a written answer, a call or a usage may hold, each key unread until it is checked. */
type Written = Partial<
  Record<keyof Answer | "name" | "id" | "arguments" | "input_tokens" | "output_tokens", unknown>
>;

const isRecord = (value: unknown): value is Written =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * How many capture groups an expression has, counted by the expression itself: an
 * alternative that matches nothing at all always matches, and what it hands back is one
 * slot per group. Counting parentheses by hand would miss `(?:`, `\(` and a class.
 */
const capturesIn = (expression: RegExp): number =>
  (new RegExp(`${expression.source}|`).exec("")?.length ?? 1) - 1;

/**
 * One value read as an answer, or a throw naming where it came from. Keys this module
 * does not know (`stands_for`, `note`, `$schema`) are the author's own and are ignored.
 */
const held = (value: unknown, from: string, fallbackId: string): Held => {
  const refuse = (why: string): never => {
    throw new Error(`The answer ${from} is not one: ${why}`);
  };
  if (!isRecord(value)) return refuse("it is not a JSON object");
  const named = (key: "case" | "answers"): string | undefined => {
    const name = value[key];
    if (name === undefined) return undefined;
    return typeof name === "string" ? name : refuse(`\`${key}\` is not a string`);
  };
  const calls = value.tool_calls ?? [];
  if (!Array.isArray(calls)) return refuse("`tool_calls` is not a list");
  const tool_calls = calls.map((call: unknown, at) => {
    if (!isRecord(call) || typeof call.name !== "string" || call.name === "") {
      return refuse(`tool call ${at} has no \`name\``);
    }
    if (call.id !== undefined && (typeof call.id !== "string" || call.id === "")) {
      return refuse(`tool call ${at}'s \`id\` is not a string`);
    }
    return { id: call.id ?? `call_${at + 1}`, name: call.name, arguments: call.arguments };
  });
  // An answer that calls may say nothing; every other answer says something.
  const content = value.content === undefined && tool_calls.length > 0 ? "" : value.content;
  if (typeof content !== "string") return refuse("it has no `content` string");
  const usage = value.usage ?? { input_tokens: 0, output_tokens: 0 };
  if (!isRecord(usage) || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)) {
    return refuse("`usage` is not `input_tokens` and `output_tokens`, whole and not negative");
  }
  // An expression that cannot be compiled, or that captures nothing, is refused here and
  // not at the request: a broken answer must fail like a file that is not JSON.
  const quoting = new Map<string, RegExp>();
  if (value.quoting !== undefined) {
    if (!isRecord(value.quoting)) return refuse("`quoting` is not a JSON object");
    for (const [key, written] of Object.entries(value.quoting)) {
      if (typeof written !== "string") return refuse(`\`quoting.${key}\` is not a string`);
      let expression: RegExp;
      try {
        expression = new RegExp(written);
      } catch {
        return refuse(`\`quoting.${key}\` is not a regular expression`);
      }
      if (capturesIn(expression) < 1) return refuse(`\`quoting.${key}\` has no capture group`);
      quoting.set(key, expression);
    }
  }
  const name = named("case");
  const id = name ?? fallbackId;
  let next: Held | undefined;
  if (value.next !== undefined) {
    if (tool_calls.length === 0) {
      return refuse("it has a `next` but no `tool_calls` whose answer it could be");
    }
    if (
      isRecord(value.next) &&
      (value.next.answers !== undefined || value.next.case !== undefined)
    ) {
      return refuse("its `next` has an `answers` or a `case`; a link is found by walking");
    }
    next = held(value.next, from, `${id}#next`);
  }
  return {
    id,
    from,
    case: name,
    answers: named("answers"),
    content,
    tool_calls,
    usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
    quoting,
    next,
  };
};

/** Two answers one request could both be given is an author's mistake, said at once. */
const withoutDuplicates = (all: Held[]): Held[] => {
  for (const key of ["case", "answers"] as const) {
    const seen = new Map<string, Held>();
    for (const each of all) {
      const value = each[key];
      if (value === undefined) continue;
      const first = seen.get(value);
      if (first !== undefined) {
        throw new Error(
          `The answers ${first.from} and ${each.from} have the same \`${key}\`: ${JSON.stringify(value)}`,
        );
      }
      seen.set(value, each);
    }
  }
  return all;
};

/** Inline answers, validated as a file's are. An id is the `case`, else the index. */
export const inline = (answers: readonly Answer[]): Held[] =>
  withoutDuplicates(answers.map((each, at) => held(each, `answer ${at}`, String(at))));

/**
 * Every `*.json` under the folder, subfolders included, one answer per file, read fresh:
 * a module that caches answers yesterday's file after one is edited. A folder that is not
 * there holds nothing.
 *
 * A file that does not parse throws with its own path in the message, because a broken
 * double must not look like a broken product.
 */
export const inFolder = (folder: string): Held[] => {
  let files: string[];
  try {
    files = readdirSync(folder, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return withoutDuplicates(
    files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => {
        const path = join(folder, file);
        let value: unknown;
        try {
          value = JSON.parse(readFileSync(path, "utf8"));
        } catch {
          throw new Error(`The answer ${path} is not one: it is not JSON`);
        }
        return held(value, path, file.slice(0, -".json".length).replaceAll("\\", "/"));
      }),
  );
};

/** A call as a request carries it: a name, and its arguments as a value or a string. */
export type MadeCall = { name: string; arguments: unknown };

/** Arguments as a value: a string that parses is its JSON, anything else itself. */
const argumentsAsValue = (written: unknown): unknown => {
  if (typeof written !== "string") return written ?? {};
  try {
    return JSON.parse(written === "" ? "{}" : written);
  } catch {
    return written;
  }
};

/** Whether two JSON values are deep-equal: an object's keys in any order, a list's in order. */
const sameValue = (one: unknown, other: unknown): boolean => {
  if (one === other) return true;
  if (Array.isArray(one) || Array.isArray(other)) {
    return (
      Array.isArray(one) &&
      Array.isArray(other) &&
      one.length === other.length &&
      one.every((each, at) => sameValue(each, other[at]))
    );
  }
  if (!isRecord(one) || !isRecord(other)) return false;
  const keys = Object.keys(one);
  return (
    keys.length === Object.keys(other).length &&
    keys.every(
      (key) =>
        Object.hasOwn(other, key) &&
        sameValue((one as Record<string, unknown>)[key], (other as Record<string, unknown>)[key]),
    )
  );
};

/** Whether the calls made are the calls written, in order, by name and by arguments. */
const sameCalls = (made: readonly MadeCall[], written: Held["tool_calls"]): boolean =>
  made.length === written.length &&
  made.every(
    (call, at) =>
      call.name === written[at]?.name &&
      sameValue(argumentsAsValue(call.arguments), argumentsAsValue(written[at]?.arguments)),
  );

/**
 * The link a chain has reached (`D37`): one `next` per message of calls made since the
 * user's message, each checked against the calls its link wrote. A differing call, or a
 * chain run out, is nothing. An answer without `next` is answered as it always was.
 */
const walked = (found: Held, calls: readonly (readonly MadeCall[])[]): Held | undefined => {
  if (found.next === undefined) return found;
  let link: Held | undefined = found;
  for (const made of calls) {
    if (link === undefined || !sameCalls(made, link.tool_calls)) return undefined;
    link = link.next;
  }
  return link;
};

/**
 * The answer a request gets, or nothing: the case its header names, else the answer whose
 * `answers` is its last user message, the whole string, untrimmed (`ID292`); then the link
 * of its chain the calls made since that message reach (`D37`). Nothing is the
 * placeholder; it is never a call and never a guess.
 */
export const answerTo = (
  all: readonly Held[],
  asked: {
    caseName: string | null;
    lastUserMessage: string | null;
    callsSince: readonly (readonly MadeCall[])[];
  },
): Held | undefined => {
  const found =
    (asked.caseName === null ? undefined : all.find((each) => each.case === asked.caseName)) ??
    (asked.lastUserMessage === null
      ? undefined
      : all.find((each) => each.answers === asked.lastUserMessage));
  return found === undefined ? undefined : walked(found, asked.callsSince);
};

/**
 * What a miss answers (`ID166`): this text and nothing else, shaped as an answer so either
 * envelope wraps it as it wraps any other. A structured call still fails on it, because it
 * is not JSON; a free message gets a reply a person can read.
 */
export const placeholder: Held = {
  id: "(placeholder)",
  from: "(placeholder)",
  case: undefined,
  answers: undefined,
  content: "No pre generated text",
  tool_calls: [],
  usage: { input_tokens: 0, output_tokens: 0 },
  quoting: new Map(),
  next: undefined,
};
