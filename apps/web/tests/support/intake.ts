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
    if (said.skip === true) {
      questionBecomes(question.id, "skipped");
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

  if (/^\/api\/intake\/items\/[^/]+\/rule$/.test(path)) {
    return json({ rule: { text: "kept" } });
  }

  if (path === "/api/intake/read") return asStream(frames);

  if (path === "/api/intake/documents" && method === "GET") return json(rows);

  if (path === "/api/intake/documents" && method === "POST") {
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
