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

const objects = vi.hoisted(() => ({ storage: undefined as unknown, failing: false }));

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
  // A call that fails mid-stream, when a case says so: one piece, then the throw. Since
  // `SL4` a message is answered through the agent loop, which asks with tools.
  const askWithTools: typeof ai.askWithTools = (...asked) => {
    if (!objects.failing) return ai.askWithTools(...asked);
    const gone = new Error("the model went away mid-stream");
    const calls = Promise.reject(gone);
    calls.catch(() => {});
    return {
      pieces: (async function* () {
        yield "No pre";
        throw gone;
      })(),
      calls,
    };
  };
  return {
    ...real,
    ask: ai.ask,
    askStreaming: ai.askStreaming,
    askFor: ai.askFor,
    askWithTools,
  };
});

const { app } = await import("../../src/app");
const { conversationsOf } = await import("../../src/routes/conversations");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
const { forgetRequests, requestsSent } = await import("../support/ai");

beforeEach(() => {
  objects.storage = localStorageIn();
  objects.failing = false;
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
});

/**
 * No assistant during the profile intake (`S3.0`, `ID202`, the person: *"There should be
 * no assistant during the profile intake"*). Before a reading has made a profile there is
 * no conversation to open, and nothing is stored that was never true: the first `GET`
 * after the reading is the one that creates it, with the true opening.
 */
describe("before any reading (S3.0, ID202)", () => {
  it("answers 409 and creates nothing, twice, so the first GET after a reading writes the true opening", async () => {
    const person = await signedIn("conversation-before-a-reading@example.com");
    const open = () =>
      app.request("/api/conversations/profile", { headers: { cookie: person.cookie } });

    const first = await open();
    const second = await open();

    expect(first.status).toBe(409);
    expect(((await first.json()) as { error: string }).error).toBe("nothing read yet");
    expect(second.status).toBe(409);

    await documentsFor(
      person.id,
      [theSet.cvFrench.filename],
      objects.storage as ReturnType<typeof localStorageIn>,
    );
    await (
      await app.request("/api/intake/read", { method: "POST", headers: { cookie: person.cookie } })
    ).text();
    const after = await open();
    const body = (await after.json()) as Answer;

    expect(after.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.parts[0]?.text).toBe(
      "I read your 1 document. Every fact on the right carries the document it came from, and I wrote nothing that is not in them.",
    );
  });
});

/**
 * Seam B: a free message, `POST /:assistant/messages` (`SL3`, `US2`, `ID163`, `ID169`,
 * `ID170`). What is read is the stream a browser reads, and then the conversation through
 * `GET`: no table is read here.
 */
type Leaf = { kind: string; text?: string; message?: string; entry?: Answer["entries"][number] };

/** The leaves of an event stream, in order: every `data:` line, parsed. */
const leavesOf = (body: string): Leaf[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => (JSON.parse(line.slice("data: ".length)) as { leaf: Leaf }).leaf);

/** The kinds in order, a run of the same kind said once: `entry, text, entry, done`. */
const shapeOf = (leaves: Leaf[]): string[] =>
  leaves.map((leaf) => leaf.kind).filter((kind, at, all) => all[at - 1] !== kind);

const post = async (
  path: string,
  text: string,
  cookie?: string,
  through: { request: typeof routes.request } = routes,
) => {
  const response = await through.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ text }),
  });
  const body = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    leaves: response.ok ? leavesOf(body) : [],
  };
};

describe("a free message (US2, SL3)", () => {
  it("writes the person's entry, streams the reply, writes it, and GET holds all three in order", async () => {
    const person = await signedIn("message-on-a-miss@example.com");

    const { status, type, leaves } = await post(
      "/api/conversations/profile/messages",
      "  I ran the services, not the cluster.  ",
      person.cookie,
    );

    expect(status).toBe(200);
    expect(type).toContain("text/event-stream");
    expect(shapeOf(leaves)).toEqual(["entry", "status", "text", "entry", "done"]);
    expect(leaves[0]?.entry).toMatchObject({
      position: 2,
      author: "person",
      parts: [{ kind: "text", text: "I ran the services, not the cluster." }],
    });
    expect(
      leaves
        .filter((leaf) => leaf.kind === "text")
        .map((leaf) => leaf.text)
        .join(""),
    ).toBe("No pre generated text");
    expect(leaves.at(-2)?.entry).toMatchObject({
      position: 3,
      author: "assistant",
      parts: [{ kind: "text", text: "No pre generated text" }],
    });

    const { body } = await get("/api/conversations/profile", person.cookie);
    expect(
      body.entries.map((entry) => [entry.position, entry.author, entry.parts[0]?.text]),
    ).toEqual([
      [1, "assistant", `Hello, ${person.id}.`],
      [2, "person", "I ran the services, not the cluster."],
      [3, "assistant", "No pre generated text"],
    ]);

    // Step 1 of this conversation's message, named per step (`ID182`), asked with the
    // profile as it stands as a system message (`ID193`; this test's definition has no
    // prompt of its own), then the conversation as messages (`ID162`).
    const [sent] = requestsSent();
    expect(requestsSent()).toHaveLength(1);
    expect(sent?.headers["x-jobapp-case"]).toBe(`profile.message:${body.id}#1`);
    expect((sent?.body as { messages: unknown[] } | undefined)?.messages).toEqual([
      { role: "system", content: expect.stringContaining("profile") },
      { role: "assistant", content: `Hello, ${person.id}.` },
      { role: "user", content: "I ran the services, not the cluster." },
    ]);
  });

  it("keeps the person's entry, writes no half reply, and ends on an error frame when the call fails mid-stream", async () => {
    const person = await signedIn("message-fails@example.com");
    objects.failing = true;

    const { status, leaves } = await post(
      "/api/conversations/profile/messages",
      "Something.",
      person.cookie,
    );

    expect(status).toBe(200);
    expect(shapeOf(leaves)).toEqual(["entry", "status", "text", "error"]);
    expect(leaves.at(-1)?.message).toEqual(expect.any(String));
    const { body } = await get("/api/conversations/profile", person.cookie);
    expect(body.entries.map((entry) => entry.author)).toEqual(["assistant", "person"]);
  });

  /** What the agent is doing, streamed and never stored (`S7.5`, `ID210`, spec `H27`). */
  it("streams the step's phrase as a status leaf before the reply's words, and stores none of it", async () => {
    const person = await signedIn("message-status@example.com");

    const { leaves } = await post(
      "/api/conversations/profile/messages",
      "Which document did you read first?",
      person.cookie,
    );

    const status = leaves.findIndex((leaf) => leaf.kind === "status");
    expect(leaves[status]).toEqual({ kind: "status", text: "Reading your profile" });
    expect(status).toBeLessThan(leaves.findIndex((leaf) => leaf.kind === "text"));
    const { body } = await get("/api/conversations/profile", person.cookie);
    expect(JSON.stringify(body)).not.toContain("Reading your profile");
  });

  it("answers 401 to nobody signed in", async () => {
    const { status } = await post("/api/conversations/profile/messages", "Hello.");

    expect(status).toBe(401);
    expect(requestsSent()).toEqual([]);
  });

  it("answers 404 for an assistant no definition names, and writes nothing", async () => {
    const person = await signedIn("message-unknown@example.com");

    const { status } = await post("/api/conversations/unknown/messages", "Hello.", person.cookie);

    expect(status).toBe(404);
    expect((await get("/api/conversations/profile", person.cookie)).body.entries).toHaveLength(1);
  });

  it("answers 400 to empty text, and writes nothing", async () => {
    const person = await signedIn("message-empty@example.com");

    const { status } = await post("/api/conversations/profile/messages", "   ", person.cookie);

    expect(status).toBe(400);
    expect(requestsSent()).toEqual([]);
    expect((await get("/api/conversations/profile", person.cookie)).body.entries).toHaveLength(1);
  });

  it("puts a second person's message in their own conversation, and leaves the first's alone (US5)", async () => {
    const first = await signedIn("message-first@example.com");
    const second = await signedIn("message-second@example.com");
    await post("/api/conversations/profile/messages", "The first person's words.", first.cookie);

    await post("/api/conversations/profile/messages", "The second person's words.", second.cookie);

    const theirs = JSON.stringify((await get("/api/conversations/profile", first.cookie)).body);
    const mine = JSON.stringify((await get("/api/conversations/profile", second.cookie)).body);
    expect(theirs).toContain("The first person's words.");
    expect(theirs).not.toContain("The second person's words.");
    expect(mine).toContain("The second person's words.");
    expect(mine).not.toContain("The first person's words.");
  });

  /**
   * What the person writes about an item is a message naming it (agent-consolidation `S8.7`,
   * `ID233`, `ID163`): the entry holds an `about` part whose `where` the server composes from
   * the item, then the words.
   */
  describe("about an item (S8.7, ID233)", () => {
    type Item = { id: string; title: string; lines: { id: string }[] };

    /** A person with a reading behind them, and one of their items with at least two lines. */
    const aPersonWithAnItem = async (email: string) => {
      const person = await signedIn(email);
      await documentsFor(
        person.id,
        [theSet.cvFrench.filename, theSet.cvWord2022.filename, theSet.cv2025.filename],
        objects.storage as ReturnType<typeof localStorageIn>,
      );
      await (
        await app.request("/api/intake/read", {
          method: "POST",
          headers: { cookie: person.cookie },
        })
      ).text();
      const profile = (await (
        await app.request("/api/intake/profile", { headers: { cookie: person.cookie } })
      ).json()) as { experience: Item[] };
      const item = profile.experience.find((each) => each.lines.length >= 2);
      if (item === undefined) throw new Error("the reading made no post with two lines");
      return { person, item };
    };

    const postAbout = async (cookie: string, body: unknown) => {
      const response = await routes.request("/api/conversations/profile/messages", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, leaves: response.ok ? leavesOf(text) : [] };
    };

    it("stores the person's entry as the item's where, composed on the server, then the words", async () => {
      const { person, item } = await aPersonWithAnItem("about-an-item@example.com");

      const { status, leaves } = await postAbout(person.cookie, {
        text: "  I only ran the migration.  ",
        about: { itemId: item.id, where: "written by the browser" },
      });

      expect(status).toBe(200);
      const mine = [
        { kind: "about", itemId: item.id, where: item.title },
        { kind: "text", text: "I only ran the migration." },
      ];
      expect(leaves[0]?.entry).toMatchObject({ author: "person", parts: mine });
      expect(shapeOf(leaves).at(-1)).toBe("done");
      const { body } = await get("/api/conversations/profile", person.cookie);
      expect(body.entries.find((entry) => entry.author === "person")?.parts).toEqual(mine);
      expect(JSON.stringify(body)).not.toContain("written by the browser");
    });

    it("names a line of the item as the item's title and its row", async () => {
      const { person, item } = await aPersonWithAnItem("about-a-line@example.com");
      const second = item.lines[1]?.id ?? "";

      const { status, leaves } = await postAbout(person.cookie, {
        text: "Somebody else wrote this.",
        about: { itemId: item.id, lineId: second },
      });

      expect(status).toBe(200);
      expect(leaves[0]?.entry?.parts[0]).toEqual({
        kind: "about",
        itemId: item.id,
        lineId: second,
        where: `${item.title} · row 2`,
      });
    });

    it("answers 404 for another person's item, and writes nothing", async () => {
      const { item } = await aPersonWithAnItem("about-the-owner@example.com");
      const other = await signedIn("about-somebody-else@example.com");

      const { status } = await postAbout(other.cookie, {
        text: "Not mine to say.",
        about: { itemId: item.id },
      });

      expect(status).toBe(404);
      expect(requestsSent()).toEqual([]);
      expect((await get("/api/conversations/profile", other.cookie)).body.entries).toHaveLength(1);
    });

    it("answers 404 for a line that is not the item's, and writes nothing", async () => {
      const { person, item } = await aPersonWithAnItem("about-a-stranger-line@example.com");

      const { status } = await postAbout(person.cookie, {
        text: "Which line?",
        about: { itemId: item.id, lineId: "line-of-nobody" },
      });

      expect(status).toBe(404);
      expect(requestsSent()).toEqual([]);
    });
  });

  it("leaves the profile exactly as it was", async () => {
    const person = await signedIn("message-profile-unchanged@example.com");
    await documentsFor(
      person.id,
      [theSet.cvFrench.filename],
      objects.storage as ReturnType<typeof localStorageIn>,
    );
    await (
      await app.request("/api/intake/read", { method: "POST", headers: { cookie: person.cookie } })
    ).text();
    const profile = async () =>
      (await app.request("/api/intake/profile", { headers: { cookie: person.cookie } })).json();
    const before = await profile();

    const { status, leaves } = await post(
      "/api/conversations/profile/messages",
      "Drop the diploma.",
      person.cookie,
      app,
    );

    expect(status).toBe(200);
    expect(shapeOf(leaves).at(-1)).toBe("done");
    expect(await profile()).toEqual(before);
  });
});
