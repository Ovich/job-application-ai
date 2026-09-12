import { beforeEach, describe, expect, it, vi } from "vitest";
import { subjectAt } from "../support/providers";
import { localStorageIn } from "../support/storage";

/**
 * Seam B: `routes/intake`, `POST /questions/:id/answer` and `POST /items/:id/rule`
 * (criteria 6, 7, 8).
 *
 * Behind the seam: PGlite, and the same recorded cases seam A drives. The seam is the
 * route, and **every answer is read back through `GET /profile`** — never by selecting
 * from the rule or the question table, because the one thing criterion 7 is about is
 * that two rows survive, and a select would prove that while the screen showed one.
 *
 * Not past it: what the builder later does with a rule. This file proves a rule is
 * written, superseded and readable; `SL5` proves it survives a return.
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

const { testDb } = await import("../support/database");
const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
const { forgetRequests } = await import("../support/ai");
const { itemNamed } = await import("../support/intake");
const support = await import("../support/intake");

let storage: ReturnType<typeof localStorageIn>;

beforeEach(() => {
  storage = localStorageIn();
  objects.storage = storage;
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

const three = [
  theSet.cvFrench.filename,
  theSet.cvWord2022.filename,
  theSet.cv2025.filename,
] as const;

const profileOf = async (cookie: string): Promise<support.ProfileAnswer> =>
  (await (await app.request("/api/intake/profile", { headers: { cookie } })).json()) as never;

/** A person whose run has left them the four questions the shipped case proposes. */
const asked = async (email: string) => {
  const person = await signedIn(email);
  await documentsFor(person.id, three);
  await (
    await app.request("/api/intake/read", { method: "POST", headers: { cookie: person.cookie } })
  ).text();
  return { ...person, profile: await profileOf(person.cookie) };
};

const answer = (
  cookie: string,
  questionId: string,
  said: { optionId?: string; words?: string; skip?: boolean },
) =>
  app.request(`/api/intake/questions/${questionId}/answer`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(said),
  });

const ruleOn = (cookie: string, itemId: string, words: string) =>
  app.request(`/api/intake/items/${itemId}/rule`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ words }),
  });

/** The question a case is about, by the item it hangs on. */
const about = (profile: support.ProfileAnswer, title: string): support.AskedQuestion => {
  const found = profile.questions.find((question) => question.itemTitle === title);
  if (found === undefined) throw new Error(`no question about ${title}`);
  return found;
};

describe("answering with a row the reader offered (criterion 6)", () => {
  it("writes a rule on the item, in the row's own words, from the answer", async () => {
    const person = await asked("answer-with-a-pick@example.com");
    const question = about(person.profile, "Kubernetes");
    const picked = question.options[1];

    const response = await answer(person.cookie, question.id, { optionId: picked?.id });
    expect(response.status).toBe(200);

    const after = await profileOf(person.cookie);
    const item = itemNamed(after, "Kubernetes");
    expect(item.rule?.text).toBe(
      "Kubernetes: deploying and running services, never cluster administration",
    );
    expect(item.rule?.source).toBe("answer");
    expect(about(after, "Kubernetes").state).toBe("answered");
  });

  it("writes the person's own words verbatim, as their own words", async () => {
    const person = await asked("answer-with-words@example.com");
    const question = about(person.profile, "Terraform");

    await answer(person.cookie, question.id, {
      words: "I wrote the modules but somebody else applied them",
    });

    const item = itemNamed(await profileOf(person.cookie), "Terraform");
    expect(item.rule?.text).toContain("I wrote the modules but somebody else applied them");
    expect(item.rule?.text.startsWith("Terraform: ")).toBe(true);
    expect(item.rule?.source).toBe("own words");
  });

  /** `US6`: the person's own words are accepted beside a choice, and both are carried. */
  it("carries a pick and the words beside it in one rule", async () => {
    const person = await asked("answer-with-both@example.com");
    const question = about(person.profile, "Kubernetes");

    await answer(person.cookie, question.id, {
      optionId: question.options[0]?.id,
      words: "three clusters, one of them on bare metal",
    });

    const item = itemNamed(await profileOf(person.cookie), "Kubernetes");
    expect(item.rules.length).toBe(1);
    expect(item.rule?.text).toContain("Kubernetes: cluster administration, and the services on it");
    expect(item.rule?.text).toContain("three clusters, one of them on bare metal");
  });

  it("refuses an answer that says nothing at all", async () => {
    const person = await asked("answer-with-nothing@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await answer(person.cookie, question.id, {})).status).toBe(400);
    expect(itemNamed(await profileOf(person.cookie), "Kubernetes").rule).toBeNull();
  });
});

describe("answering again (criterion 7, ID121)", () => {
  it("adds a rule and supersedes the old one, and both are still readable", async () => {
    const person = await asked("answer-twice@example.com");
    const question = about(person.profile, "Kubernetes");

    await answer(person.cookie, question.id, { optionId: question.options[0]?.id });
    const first = itemNamed(await profileOf(person.cookie), "Kubernetes").rule;
    await answer(person.cookie, question.id, { optionId: question.options[2]?.id });

    const item = itemNamed(await profileOf(person.cookie), "Kubernetes");
    expect(item.rules.length).toBe(2);
    expect(item.rule?.text).toBe("Kubernetes: shipping to a cluster run by others");
    expect(item.rules.map((rule) => rule.text)).toContain(
      "Kubernetes: cluster administration, and the services on it",
    );
    // Nothing was overwritten: the first row is the same row, superseded.
    expect(item.rules.map((rule) => rule.id)).toContain(first?.id);
  });
});

describe("skipping (criterion 8, US7)", () => {
  it("keeps the question rather than deleting it, and answers nothing for it", async () => {
    const person = await asked("skip-one@example.com");
    const question = about(person.profile, "Kubernetes");

    expect((await answer(person.cookie, question.id, { skip: true })).status).toBe(200);

    const after = await profileOf(person.cookie);
    expect(about(after, "Kubernetes").state).toBe("skipped");
    expect(itemNamed(after, "Kubernetes").rule).toBeNull();
    expect(after.questions.length).toBe(person.profile.questions.length);
  });

  it("counts two answered and one for the builder", async () => {
    const person = await asked("skip-and-count@example.com");
    const [first, second, third] = person.profile.questions;

    await answer(person.cookie, first?.id ?? "", { optionId: first?.options[0]?.id });
    await answer(person.cookie, second?.id ?? "", { optionId: second?.options[0]?.id });
    await answer(person.cookie, third?.id ?? "", { skip: true });

    const after = await profileOf(person.cookie);
    const counted = (state: string) =>
      after.questions.filter((question) => question.state === state).length;
    expect(counted("answered")).toBe(2);
    expect(counted("skipped")).toBe(1);
  });
});

describe("what belongs to somebody else, and what is gone (US11, Failure modes)", () => {
  it("answers 404 for another person's question, and touches no row of theirs", async () => {
    const owner = await asked("answer-owner@example.com");
    const stranger = await signedIn("answer-stranger@example.com");
    const question = about(owner.profile, "Kubernetes");

    const response = await answer(stranger.cookie, question.id, {
      optionId: question.options[0]?.id,
    });

    expect(response.status).toBe(404);
    expect(itemNamed(await profileOf(owner.cookie), "Kubernetes").rule).toBeNull();
  });

  it("answers 404 once the item has been removed, and the question is gone with it", async () => {
    const person = await asked("answer-after-removal@example.com");
    const question = about(person.profile, "Kubernetes");
    const { profileItem } = await import("@app/db");
    const { eq } = await import("drizzle-orm");
    await testDb.delete(profileItem).where(eq(profileItem.id, question.itemId));

    expect(
      (await answer(person.cookie, question.id, { optionId: question.options[0]?.id })).status,
    ).toBe(404);
    expect((await profileOf(person.cookie)).questions.some((each) => each.id === question.id)).toBe(
      false,
    );
  });
});

/**
 * The same handler as the answer's own-words path, with no question attached. It is
 * mounted and proved here because that is what it is; **its screen is `SL5`'s**.
 */
describe("a rule on an item nobody asked about (SL5's caller)", () => {
  it("writes what the person said as that item's rule", async () => {
    const person = await asked("rule-without-a-question@example.com");
    const docker = itemNamed(person.profile, "Docker");

    const response = await ruleOn(person.cookie, docker.id, "I only ever wrote the Dockerfiles");
    expect(response.status).toBe(200);

    const item = itemNamed(await profileOf(person.cookie), "Docker");
    expect(item.rule?.text).toBe("Docker: I only ever wrote the Dockerfiles");
    expect(item.rule?.source).toBe("own words");
  });

  it("answers 404 for an item that is not this person's", async () => {
    const owner = await asked("rule-owner@example.com");
    const stranger = await signedIn("rule-stranger@example.com");
    const docker = itemNamed(owner.profile, "Docker");

    expect((await ruleOn(stranger.cookie, docker.id, "not mine")).status).toBe(404);
    expect(itemNamed(await profileOf(owner.cookie), "Docker").rule).toBeNull();
  });
});
