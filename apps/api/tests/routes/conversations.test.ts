import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantDefinition } from "../../src/lib/agent";
import { subjectAt } from "../support/providers";
import { localStorageIn } from "../support/storage";

/**
 * Seam A: the conversations route, through `app.request` (`S2.2`, `US5`, `US8`, `ID186`).
 *
 * Behind it: the session as today's route tests stand it in (a sign-in round trip with
 * the provider stood in for), and `lib/db` swapped for PGlite. Most cases build the route
 * with a registry holding a test definition, so what is proved is the route and not the
 * intake's wording; the last two use the application as it is composed, with the profile
 * assistant's own opening, once with a reading behind it and once with none.
 *
 * Not past it: `lib/conversation`'s own cases, which are seam C's. Every answer is read
 * back through the route.
 */

const objects = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("../../src/lib/db", async () => ({
  db: (await import("../support/database")).testDb,
}));

vi.mock("../../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/storage")>()),
  get storage() {
    return objects.storage;
  },
}));

vi.mock("../../src/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/ai")>();
  const { aiThroughTheApp } = await import("../support/ai");
  const ai = aiThroughTheApp();
  return { ...real, ask: ai.ask, askStreaming: ai.askStreaming, askFor: ai.askFor };
});

const { app } = await import("../../src/app");
const { conversationsOf } = await import("../../src/routes/conversations");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
const { forgetRequests } = await import("../support/ai");

beforeEach(() => {
  objects.storage = localStorageIn();
  forgetRequests();
});

const signedIn = async (email: string) => {
  const response = await signInThrough("google", {
    subject: subjectAt("google", email),
    name: "Someone Seeking",
    email,
    emailVerified: true,
  });
  const user = await signedInAs(response);
  if (user === null) throw new Error(`the sign-in for ${email} produced no session`);
  vi.unstubAllGlobals();
  return { id: user.id, cookie: cookiesSetBy(response) };
};

type Answer = {
  id: string;
  entries: { position: number; author: string; parts: { kind: string; text?: string }[] }[];
};

/** A definition of the test's own: its opening says whose it is, so a leak would show. */
const aTestAssistant: AssistantDefinition = {
  name: "profile",
  prompt: "",
  tools: [],
  opening: async (_tx, person) => [{ kind: "text", text: `Hello, ${person}.`, scripted: true }],
};

const routes = new Hono().route("/api/conversations", conversationsOf([aTestAssistant]));

const get = async (path: string, cookie?: string) => {
  const response = await routes.request(path, cookie === undefined ? {} : { headers: { cookie } });
  return { status: response.status, body: (await response.json()) as Answer & { error?: string } };
};

describe("opening the profile's conversation (US8)", () => {
  it("creates it with the definition's opening as entry 1", async () => {
    const person = await signedIn("conversation-opens@example.com");

    const { status, body } = await get("/api/conversations/profile", person.cookie);

    expect(status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      position: 1,
      author: "assistant",
      parts: [{ kind: "text", text: `Hello, ${person.id}.`, scripted: true }],
    });
  });

  it("answers the same conversation a second time, and adds nothing to it", async () => {
    const person = await signedIn("conversation-twice@example.com");

    const first = await get("/api/conversations/profile", person.cookie);
    const second = await get("/api/conversations/profile", person.cookie);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.entries).toHaveLength(1);
  });

  it("keeps two subjects as two conversations", async () => {
    const person = await signedIn("conversation-subjects@example.com");

    const one = await get("/api/conversations/profile?subject=one", person.cookie);
    const other = await get("/api/conversations/profile?subject=other", person.cookie);

    expect(other.body.id).not.toBe(one.body.id);
  });
});

describe("somebody else (US5)", () => {
  it("opens their own conversation, holding none of the first person's entries", async () => {
    const first = await signedIn("conversation-first@example.com");
    const second = await signedIn("conversation-second@example.com");
    const theirs = await get("/api/conversations/profile", first.cookie);

    const mine = await get("/api/conversations/profile", second.cookie);

    expect(mine.body.id).not.toBe(theirs.body.id);
    expect(JSON.stringify(mine.body.entries)).not.toContain(first.id);
    expect(mine.body.entries[0]?.parts).toEqual([
      { kind: "text", text: `Hello, ${second.id}.`, scripted: true },
    ]);
  });
});

describe("the refusals", () => {
  it("answers 401 to nobody signed in", async () => {
    const { status, body } = await get("/api/conversations/profile");

    expect(status).toBe(401);
    expect(body.error).toBe("sign in first");
  });

  it("answers 404 for an assistant no definition names (ID186)", async () => {
    const person = await signedIn("conversation-unknown@example.com");

    const { status } = await get("/api/conversations/unknown", person.cookie);

    expect(status).toBe(404);
  });
});

describe("the profile assistant's own opening, as the application is composed (ID189)", () => {
  const textsOf = (answer: Answer) =>
    (answer.entries[0]?.parts ?? []).map((part) => ({ ...part }) as Record<string, unknown>);

  it("names the documents read, then the tail, and ends on the first waiting question's opener", async () => {
    const person = await signedIn("conversation-after-a-reading@example.com");
    await documentsFor(
      person.id,
      [theSet.cvFrench.filename, theSet.cvWord2022.filename, theSet.cv2025.filename],
      objects.storage as ReturnType<typeof localStorageIn>,
    );
    await (
      await app.request("/api/intake/read", { method: "POST", headers: { cookie: person.cookie } })
    ).text();
    const profile = (await (
      await app.request("/api/intake/profile", { headers: { cookie: person.cookie } })
    ).json()) as { documents: number; questions: { itemTitle: string; state: string }[] };
    const first = profile.questions.find((question) => question.state === "waiting");
    expect(profile.documents).toBeGreaterThan(0);
    expect(first).toBeDefined();

    const response = await app.request("/api/conversations/profile", {
      headers: { cookie: person.cookie },
    });
    const parts = textsOf((await response.json()) as Answer);

    expect(response.status).toBe(200);
    expect(parts).toEqual([
      {
        kind: "text",
        text: `I read your ${profile.documents} documents. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.`,
        scripted: true,
      },
      {
        kind: "text",
        text: "Some facts say what you did but not what your part was, or two documents disagree. I ask only those. Everything else I could tell from your documents.",
        scripted: true,
      },
      { kind: "text", text: `First, ${first?.itemTitle}.`, scripted: true },
    ]);
  });

  it("has a form for a person with nothing read yet, and asks nothing", async () => {
    const person = await signedIn("conversation-nothing-read@example.com");

    const response = await app.request("/api/conversations/profile", {
      headers: { cookie: person.cookie },
    });
    const parts = textsOf((await response.json()) as Answer);

    expect(response.status).toBe(200);
    expect(parts).toEqual([
      {
        kind: "text",
        text: "I have not read any of your documents yet. Hand them over and I will read them.",
        scripted: true,
      },
    ]);
  });
});
