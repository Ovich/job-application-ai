import { alsoAnswering } from "./session";

/**
 * The intake's routes, stood in for at the same seam the library's are: `fetch`, which
 * the RPC client took once when it was built (`tests/support/session.ts`).
 *
 * What is hidden here is the wire: the multipart body an upload travels in, the
 * server-sent-event framing a run comes back in, and which address is which route. A
 * case says what the API holds and what it refuses, and reads back what a person sees.
 *
 * A refusal is the route's own sentence, never one invented in the browser, so a case
 * that stands in for a 409 states the sentence and the screen shows exactly it.
 */

/** A row as the list route answers it. Fewer fields than the table, on purpose. */
export type Row = {
  id: string;
  filename: string;
  mediaType: string;
  source: string;
  address: string | null;
  detectedKind: string | null;
  detectedLanguage: string | null;
  status: string;
  failureReason: string | null;
  readAt: string | null;
};

/** One thing the reading run says, as a leaf of the stream. */
export type Frame =
  | { kind: "document"; id: string; status: "reading" | "read" | "failed"; reason: string | null }
  | { kind: "run"; status: "done" };

/** A row with everything but what a case cares about filled in. */
export const rowOf = (row: Partial<Row> & { id: string; filename: string }): Row => ({
  mediaType: "application/pdf",
  source: "file",
  address: null,
  detectedKind: "cv",
  detectedLanguage: null,
  status: "waiting",
  failureReason: null,
  readAt: null,
  ...row,
});

/**
 * One item of a profile, as `GET /api/intake/profile` answers it: the spine, the block
 * for its own kind, its lines, what hangs under it, and what each document said about
 * it. Nothing here is reshaped, because nothing is reshaped on the wire either.
 */
export type Item = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  startText: string | null;
  endText: string | null;
  documents: number;
  experience: {
    organisation: string;
    organisationNote: string | null;
    location: string | null;
    arrangement: string | null;
  } | null;
  project: { description: string; datesText: string | null } | null;
  education: {
    institution: string;
    location: string | null;
    credential: string | null;
    note: string | null;
  } | null;
  entry: { label: string; qualifier: string | null } | null;
  lines: { id: string; text: string; documents: number; sources: Quote[] }[];
  children: Item[];
  sources: Quote[];
  /** What the person said about it, newest first, and the one nothing superseded. */
  rules: Rule[];
  rule: Rule | null;
  /** The question this intake asked about it, whatever state it is now in. */
  question: Question | null;
};

type Quote = { document: string; said: string };

/** One rule on the wire, as `GET /profile` carries it (SL4, ID121). */
export type Rule = {
  id: string;
  text: string;
  kind: "scope" | "constraint";
  source: "answer" | "own words";
  createdAt: string;
  supersededBy: string | null;
};

/** One question on the wire, with the item it is about and the rows it offers. */
export type Question = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: "scope" | "conflict" | "provenance";
  where: string;
  lead: string;
  state: "waiting" | "answered" | "skipped";
  options: { id: string; label: string; hint: string; rule: string | null }[];
};

export type Profile = {
  name: string | null;
  documents: number;
  readOn: string | null;
  summary: Item | null;
  identity: Item | null;
  experience: Item[];
  projects: Item[];
  groups: Item[];
  education: Item[];
  questions: Question[];
  notAsked: number;
};

/** An item with everything but what a case cares about filled in. */
export const itemOf = (
  item: Partial<Item> & { id: string; kind: string; title: string },
): Item => ({
  subtitle: null,
  startText: null,
  endText: null,
  documents: 1,
  experience: null,
  project: null,
  education: null,
  entry: null,
  lines: [],
  children: [],
  sources: [],
  rules: [],
  rule: null,
  question: null,
  ...item,
});

/** A question with everything but what a case cares about filled in. */
export const questionOf = (
  question: Partial<Question> & { id: string; itemId: string; lead: string },
): Question => ({
  itemTitle: "Kubernetes",
  kind: "scope",
  where: "What you work with · DevOps and cloud · in 2 documents",
  state: "waiting",
  options: [
    {
      id: `${question.id}-1`,
      label: "Ran the cluster",
      hint: "nodes, upgrades, access",
      rule: "Kubernetes: cluster administration, and the services on it",
    },
    {
      id: `${question.id}-2`,
      label: "Ran services on it",
      hint: "deployed and operated the workloads",
      rule: "Kubernetes: deploying and running services, never cluster administration",
    },
    {
      id: `${question.id}-3`,
      label: "Used it as a developer",
      hint: "shipped to a cluster someone else ran",
      rule: "Kubernetes: shipping to a cluster run by others",
    },
    { id: `${question.id}-own`, label: "Something else", hint: "say it below", rule: null },
  ],
  ...question,
});

/** A profile with nothing in it: the answer a person who has read nothing gets. */
export const emptyProfile: Profile = {
  name: null,
  documents: 0,
  readOn: null,
  summary: null,
  identity: null,
  experience: [],
  projects: [],
  groups: [],
  education: [],
  questions: [],
  notAsked: 0,
};

let profile: Profile = emptyProfile;

/** How many rules the person has written themselves, so each one gets its own id. */
let ruleCount = 1;

/** Every item of a profile, the nesting flattened, so one can be found by its id. */
const everyItemOf = (given: Profile): Item[] => {
  const all: Item[] = [];
  const walk = (items: Item[]): void => {
    for (const item of items) {
      all.push(item);
      walk(item.children);
    }
  };
  walk([
    ...(given.summary === null ? [] : [given.summary]),
    ...(given.identity === null ? [] : [given.identity]),
    ...given.experience,
    ...given.projects,
    ...given.groups,
    ...given.education,
  ]);
  return all;
};

/** That question is now in that state, in the profile the route answers from now on. */
const questionBecomes = (id: string, state: Question["state"]): void => {
  const move = (question: Question): Question =>
    question.id === id ? { ...question, state } : question;
  const inItem = (item: Item): Item => ({
    ...item,
    question: item.question === null ? null : move(item.question),
    children: item.children.map(inItem),
  });
  profile = {
    ...profile,
    questions: profile.questions.map(move),
    summary: profile.summary === null ? null : inItem(profile.summary),
    identity: profile.identity === null ? null : inItem(profile.identity),
    experience: profile.experience.map(inItem),
    projects: profile.projects.map(inItem),
    groups: profile.groups.map(inItem),
    education: profile.education.map(inItem),
  };
};

/** The rule the answer wrote, on its item, superseding the one before it. */
const ruleLandsOn = (itemId: string, rule: Rule): void => {
  const onItem = (item: Item): Item =>
    item.id === itemId
      ? {
          ...item,
          rule,
          rules: [rule, ...item.rules.map((each) => ({ ...each, supersededBy: rule.id }))],
        }
      : { ...item, children: item.children.map(onItem) };
  profile = {
    ...profile,
    summary: profile.summary === null ? null : onItem(profile.summary),
    identity: profile.identity === null ? null : onItem(profile.identity),
    experience: profile.experience.map(onItem),
    projects: profile.projects.map(onItem),
    groups: profile.groups.map(onItem),
    education: profile.education.map(onItem),
  };
};

/** What the profile route answers. */
export const profileIs = (given: Partial<Profile>): Profile => {
  profile = { ...emptyProfile, ...given };
  return profile;
};

let rows: Row[] = [];
let refusal: { status: number; body: unknown } | null = null;
let frames: Frame[] = [];
let requests: { method: string; address: string }[] = [];
let dropping: string | null = null;

/** What the list route answers. */
export const documentsAre = (given: Row[]): void => {
  rows = [...given];
};

/** What the list route answers from now on, as the reading run left it. */
export const documentsBecome = documentsAre;

/**
 * Which document the next drop is of, for a runtime that cannot serialise a multipart
 * body (see `uploadIn`). Only a case that actually drops a file needs it.
 */
export const droppingNext = (filename: string): void => {
  dropping = filename;
};

/** An upload the case has not let through yet. */
let held: Promise<void> | null = null;

/**
 * The next upload stays on its way up until the case lets it land, which is the only way
 * to stand at the moment a person presses Read while the rest of a drop is still
 * arriving. What it hands back is the letting.
 */
export const holdingNextUpload = (): (() => void) => {
  let release = (): void => {};
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => release();
};

/** The next upload is refused, with the status and the body the route would send. */
export const uploadRefused = (status: number, body: unknown): void => {
  refusal = { status, body };
};

/** What the reading run says, in order. */
export const runSays = (given: Frame[]): void => {
  frames = [...given];
};

/** Every intake request the screen made, in order. */
export const intakeRequests = (): { method: string; address: string }[] => requests;

export const resetIntake = (): void => {
  profile = emptyProfile;
  rows = [];
  refusal = null;
  frames = [];
  requests = [];
  dropping = null;
  held = null;
  ruleCount = 1;
  conversation = null;
  resetReplies();
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * The frames as the envelope puts them on the wire: `id:` and `data:`, one per block.
 *
 * The rows move with them, because that is what the API does: a frame is sent after the
 * row is written, so a screen that reads the list again when the run is done finds what
 * the frames said. A stand-in whose rows stood still would let a screen pass that threw
 * the run's own answers away.
 */
const asStream = (given: Frame[]): Response => {
  for (const leaf of given) {
    if (leaf.kind !== "document") continue;
    rows = rows.map((row) =>
      row.id === leaf.id ? { ...row, status: leaf.status, failureReason: leaf.reason } : row,
    );
  }
  return new Response(
    given
      .map(
        (leaf, at) =>
          `id: ${at + 1}\ndata: ${JSON.stringify({ seq: at + 1, version: 1, leaf })}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
};

/**
 * What an upload carries, read out of the multipart body the client serialised.
 *
 * Read by hand rather than through `Response.formData`, so this stand-in depends on
 * nothing the test runtime may or may not implement, and so that what is asserted is
 * the body the API would actually receive: a filename in a disposition line, or the
 * typed address between the blank line and the boundary.
 */
const uploadIn = (body: unknown): { filename?: string; address?: string } => {
  // A runtime that cannot serialise a `FormData` into bytes hands it on as it is. The
  // browser does serialise it, which is the case the regexes below read.
  if (body instanceof FormData) {
    const file = body.get("file");
    if (file instanceof File) return { filename: file.name };
    const typed = body.get("address");
    return typeof typed === "string" ? { address: typed } : {};
  }
  const text =
    typeof body === "string"
      ? body
      : new TextDecoder().decode(body as ArrayBufferView | ArrayBuffer);
  const filename = /name="file";\s*filename="([^"]*)"/.exec(text)?.[1];
  if (filename !== undefined) return { filename };
  const address = /name="address"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(text)?.[1];
  if (address !== undefined) return { address };
  // jsdom cannot serialise a `FormData` at all: it turns one into the two words
  // `[object FormData]`, so a body that went through the client's payload hash arrives
  // here with nothing in it. That is the test runtime's limit and not the product's — a
  // browser writes the multipart, and the end-to-end spec drives a real drop through a
  // real one. A case that drops a file therefore says beforehand which document it is,
  // and what it asserts is what the screen does with the route's answer.
  return dropping === null ? {} : { filename: dropping };
};

/**
 * One entry of a conversation, as `GET /api/conversations/:assistant` answers it. A part
 * is anything with a kind, because a stored part of a kind the screen does not know is
 * still answered whole.
 */
export type Entry = {
  id: string;
  position: number;
  author: "person" | "assistant" | "tool";
  parts: { kind: string; [key: string]: unknown }[];
  createdAt: string;
};

/** An entry with everything but its position and parts filled in. */
export const entryOf = (
  position: number,
  parts: Entry["parts"],
  author: Entry["author"] = "assistant",
): Entry => ({
  id: `entry-${position}`,
  position,
  author,
  parts,
  createdAt: "2026-09-14T09:00:00.000Z",
});

/** Words the product wrote, as the profile assistant stores them (`ID200`). */
const scripted = (text: string) => ({ kind: "text", text, scripted: true });

/**
 * The opening the API writes for this profile, composed the way the profile assistant
 * composes it: the sentence, the tail and the first waiting question's opener. Kept in
 * step with it so a screen that draws what it is answered draws what a person would read.
 * A profile nothing has been read into has no conversation at all (`ID202`): see below.
 */
const openingOf = (given: Profile): Entry => {
  const waiting = given.questions.find((question) => question.state === "waiting");
  const moved = given.questions.some((question) => question.state !== "waiting");
  return entryOf(1, [
    scripted(
      `I read your ${given.documents} document${given.documents === 1 ? "" : "s"}. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.`,
    ),
    scripted(
      "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.",
    ),
    ...(waiting === undefined
      ? []
      : [scripted(`${moved ? "Next" : "First"}, ${waiting.itemTitle}.`)]),
  ]);
};

/**
 * What the conversations route answers, once a case or the first request has said so.
 * Created on the first request and then kept, as the API keeps it: a second request
 * reads the same conversation and adds nothing.
 */
let conversation: { status: number; body: unknown } | null = null;

/** The conversation holds exactly these entries. */
export const conversationIs = (entries: Entry[]): void => {
  conversation = { status: 200, body: { id: "conversation-1", entries } };
};

/** The conversations route refuses, with the status and the body the route would send. */
export const conversationRefused = (status: number, body: unknown): void => {
  conversation = { status, body };
};

/** One leaf of a message's stream, as the API's envelope carries it. */
export type ReplyLeaf =
  | { kind: "entry"; entry: Entry }
  | { kind: "status"; text: string }
  | { kind: "text"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** What a message's words are about, when the screen said (agent-consolidation `S8.7`). */
type About = { itemId: string; lineId?: string };

/** Every message a screen posted, in order: where to, the words, and what they are about. */
let posted: { address: string; text: string; about?: About }[] = [];

/** The frames the case has said and the open reply has not carried yet. */
let pending: string[] = [];

/** The reply stream being read, or `null` before a message is posted. */
let reply: ReadableStreamDefaultController<Uint8Array> | null = null;

let replyEnded = false;

let replySeq = 0;

const flush = (): void => {
  if (reply === null) return;
  for (const frame of pending) reply.enqueue(new TextEncoder().encode(frame));
  pending = [];
  if (replyEnded) {
    reply.close();
    reply = null;
  }
};

/** Every message posted to the conversations route, in order. */
export const messagesPosted = (): { address: string; text: string; about?: About }[] => posted;

/**
 * The reply to the message being posted, written by the case a leaf at a time, as the
 * API streams it. An `entry` leaf is kept in the conversation too, because the API
 * commits an entry before its frame: a reload reads what the stream said.
 */
export const theReply = {
  says: (leaf: ReplyLeaf): void => {
    if (leaf.kind === "entry" && conversation !== null) {
      const body = conversation.body as { id: string; entries: Entry[] };
      conversation = { ...conversation, body: { ...body, entries: [...body.entries, leaf.entry] } };
    }
    replySeq += 1;
    pending.push(
      `id: ${replySeq}\ndata: ${JSON.stringify({ seq: replySeq, version: 1, leaf })}\n\n`,
    );
    flush();
  },
  ends: (): void => {
    replyEnded = true;
    flush();
  },
};

export const resetReplies = (): void => {
  posted = [];
  pending = [];
  reply = null;
  replyEnded = false;
  replySeq = 0;
};

alsoAnswering((address, init) => {
  const path = new URL(address, "http://localhost").pathname;
  if (!/^\/api\/conversations\/[^/]+\/messages$/.test(path)) return undefined;
  requests.push({ method: init?.method ?? "GET", address: path });
  const said = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as {
    text?: string;
    about?: About;
  };
  posted.push({
    address: path,
    text: said.text ?? "",
    ...(said.about === undefined ? {} : { about: said.about }),
  });
  // A case may say the whole reply, its end included, before the request arrives: the
  // stream then carries what is pending and closes at once.
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        reply = controller;
        flush();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
});

alsoAnswering((address, init) => {
  const path = new URL(address, "http://localhost").pathname;
  if (!path.startsWith("/api/conversations/")) return undefined;
  requests.push({ method: init?.method ?? "GET", address: path });
  // Before a reading the API creates nothing and refuses (`S3.0`, `ID202`), and creates
  // nothing on a second ask either, so nothing is kept here.
  if (conversation === null && profile.documents === 0) {
    return json({ error: "nothing read yet" }, 409);
  }
  conversation ??= {
    status: 200,
    body: { id: "conversation-1", entries: [openingOf(profile)] },
  };
  return json(conversation.body, conversation.status);
});

alsoAnswering((address, init) => {
  const path = new URL(address, "http://localhost").pathname;
  if (!path.startsWith("/api/intake")) return undefined;
  const method = init?.method ?? "GET";
  requests.push({ method, address: path });

  if (path === "/api/intake/profile") return json(profile);

  /**
   * The answer and the skip, kept the way the API keeps them: the question moves state
   * and the rule lands on its item, so a screen that re-reads the profile finds what it
   * just said. A stand-in whose rows stood still would let a screen pass that threw the
   * route's own answer away.
   */
  if (/^\/api\/intake\/questions\/[^/]+\/answer$/.test(path)) {
    const id = path.split("/")[4] ?? "";
    const question = profile.questions.find((each) => each.id === id);
    if (question === undefined) return json({ error: "no such question" }, 404);
    const said = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as {
      optionId?: string;
      words?: string;
      skip?: boolean;
    };
    // The person's entry, written with the state as the API writes it (agent-consolidation
    // `S7.1`): a screen that reads the conversation again finds the answer or the skip.
    const asked = {
      lead: question.lead,
      where: question.where,
      options: question.options.map(({ id: option, label, hint }) => ({ id: option, label, hint })),
    };
    const recorded = (part: Entry["parts"][number]): void => {
      if (conversation === null || conversation.status !== 200) return;
      const body = conversation.body as { id: string; entries: Entry[] };
      const next = entryOf(body.entries.length + 1, [part], "person");
      conversation = { ...conversation, body: { ...body, entries: [...body.entries, next] } };
    };
    if (said.skip === true) {
      questionBecomes(question.id, "skipped");
      recorded({ kind: "question_skipped", ...asked });
      return json({ skipped: question.id });
    }
    const picked = question.options.find((option) => option.id === said.optionId)?.rule ?? null;
    const words = (said.words ?? "").trim();
    if (picked === null && words === "") return json({ error: "say something" }, 400);
    const text =
      picked === null
        ? `${question.itemTitle}: ${words}`
        : words === ""
          ? picked
          : `${picked} — ${words}`;
    questionBecomes(question.id, "answered");
    recorded({
      kind: "question_answered",
      ...asked,
      picked: said.optionId ?? null,
      words: words === "" ? null : words,
    });
    ruleLandsOn(question.itemId, {
      id: `rule-${profile.questions.indexOf(question) + 1}`,
      text,
      kind: question.kind === "scope" ? "scope" : "constraint",
      source: picked === null ? "own words" : "answer",
      createdAt: "2026-09-12T10:14:00.000Z",
      supersededBy: null,
    });
    return json({ rule: { text } });
  }

  /**
   * The rule the person wrote on an item nobody asked about, kept the way the API keeps
   * it: `<the item's title>: <the words>`, landing on that item and superseding whatever
   * was there. A stand-in that answered `kept` and moved nothing would let a screen pass
   * that never showed the check line a person had just written.
   */
  if (/^\/api\/intake\/items\/[^/]+\/rule$/.test(path)) {
    const id = path.split("/")[4] ?? "";
    const item = everyItemOf(profile).find((each) => each.id === id);
    if (item === undefined) return json({ error: "no such item" }, 404);
    const said = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as {
      words?: string;
      lineId?: string;
    };
    const words = (said.words ?? "").trim();
    if (words === "") return json({ error: "say it in your own words" }, 400);
    // A rule written from one of the item's lines is about that line, in the line's own
    // words, and lands on the item the line belongs to: a line carries no rule of its own.
    const line =
      said.lineId === undefined ? null : item.lines.find((each) => each.id === said.lineId);
    if (line === undefined) return json({ error: "no such line" }, 404);
    const kept: Rule = {
      id: `rule-own-${ruleCount++}`,
      text: `${line === null ? item.title : line.text}: ${words}`,
      kind: "scope",
      source: "own words",
      createdAt: "2026-09-12T10:14:00.000Z",
      supersededBy: null,
    };
    ruleLandsOn(item.id, kept);
    return json({ rule: kept });
  }

  if (path === "/api/intake/read") return asStream(frames);

  if (path === "/api/intake/documents" && method === "GET") return json(rows);

  if (path === "/api/intake/documents" && method === "POST") {
    if (held !== null) {
      // Held open by the case, and landing as any upload lands once the case lets it: a
      // row for the file, and the row in the list the route answers from then on.
      const waiting = held;
      held = null;
      const filename = uploadIn(init?.body).filename ?? "a-held-document.pdf";
      return waiting.then(() => {
        const row = rowOf({ id: `document-${rows.length + 1}`, filename });
        rows = [...rows, row];
        return json(row, 201);
      });
    }
    if (refusal !== null) {
      const refused = refusal;
      refusal = null;
      return json(refused.body, refused.status);
    }
    // The client serialises a multipart body into bytes and states its content type, so
    // what arrives here is what would arrive at the API: a lump and a boundary.
    const upload = uploadIn(init?.body);
    if (upload.filename === undefined && upload.address === undefined) {
      return json({ error: "hand over a document or type a LinkedIn address" }, 400);
    }
    const row =
      upload.filename !== undefined
        ? rowOf({ id: `document-${rows.length + 1}`, filename: upload.filename })
        : rowOf({
            id: `document-${rows.length + 1}`,
            filename: String(upload.address),
            source: "linkedin_address",
            address: String(upload.address),
            detectedKind: null,
          });
    rows = [...rows, row];
    return json(row, 201);
  }

  if (method === "DELETE") {
    const id = path.slice("/api/intake/documents/".length);
    rows = rows.filter((row) => row.id !== id);
    return json({ removed: id });
  }

  return json({ error: "no such route" }, 404);
});
