import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Support from "../support/intake";
import { subjectAt } from "../support/providers";
import { localStorageIn } from "../support/storage";

/**
 * Seam A: `routes/intake`, the questions a reading leaves open (criteria 1, 1b, 2, 3).
 *
 * **There is no fourth step any more** (`ID157`). The questions used to be a pass of
 * their own over the profile a merge had just written; they are now the second half of
 * the one answer the reading gives, and the run writes them the moment it has written
 * the profile. Every claim in this file is unchanged by that — a question is one of
 * three kinds, capped at five, hung on an item that exists, never asked about a fact the
 * documents agree on and state plainly — because those are claims about what the run
 * writes, not about when it was asked.
 *
 * Behind the seam: the same PGlite database as every other route case, and `lib/ai`
 * answering from recorded cases in this very process. The seam is the route, reached by
 * `app.request`, and the questions are read back through `GET /profile` — never with a
 * select of this file's own, because a case that queried the table would pass while the
 * route showed nothing.
 *
 * Not past it: the fixture's content. Whether "Kubernetes is in two of your documents
 * and neither says your part" is a good question is the fixture's business. That it is
 * one of three kinds, capped at five, and attached to an item that exists is this
 * file's.
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
  const { askForThroughTheApp } = await import("../support/ai");
  return { ...real, askFor: askForThroughTheApp() };
});

const { app } = await import("../../src/app");
const { cookiesSetBy, signInThrough, signedInAs } = await import("../support/sign-in");
const { documentsFor, theSet } = await import("../support/documents");
const { forgetRequests, requestsSent, withCases } = await import("../support/ai");
const { aProfileOf, caseNameFor, casesForRun, everyItem, itemNamed } =
  await import("../support/intake");

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

const read = (cookie: string) =>
  app.request("/api/intake/read", { method: "POST", headers: { cookie } });

const profileOf = async (cookie: string): Promise<Support.ProfileAnswer> =>
  (await (await app.request("/api/intake/profile", { headers: { cookie } })).json()) as never;

/** The three real documents this slice's own case stands for (`D20`, criterion 1b). */
const three = [
  theSet.cvFrench.filename,
  theSet.cvWord2022.filename,
  theSet.cv2025.filename,
] as const;

/** A run over those three, against the cases the product actually ships. */
const aShippedRun = async (email: string) => {
  const person = await signedIn(email);
  await documentsFor(person.id, three, storage);
  await (await read(person.cookie)).text();
  return { ...person, profile: await profileOf(person.cookie) };
};

describe("the questions a reading leaves open, over the cases the product ships (criteria 1, 1b)", () => {
  /**
   * This test used to assert eight calls ending in a questions pass of its own. Its
   * claim was that the questions are asked once for the run, about the run's own
   * documents, and never per document; that claim is now carried by there being one
   * call at all, which asks for the profile and the questions together (`ID157`).
   */
  it("asks for the questions in the run's one call, naming the run's own documents", async () => {
    const person = await signedIn("questions-one-call@example.com");
    await documentsFor(person.id, three, storage);

    await (await read(person.cookie)).text();

    expect(requestsSent().map((request) => request.headers["x-jobapp-case"])).toEqual([
      "intake.read:2026-08-30_cv_FR+CV-2025+leCVWeb",
    ]);
  });

  it("ends with questions written, and every one of them is one of the three kinds", async () => {
    const { profile } = await aShippedRun("questions-three-kinds@example.com");

    expect(profile.questions.length).toBeGreaterThan(0);
    for (const question of profile.questions) {
      expect(["scope", "conflict", "provenance"]).toContain(question.kind);
    }
  });

  /**
   * Criterion 1's second half. The shipped case carries a fifth candidate of a kind that
   * is not one of the three; it is dropped by the run and could not be stored anyway,
   * because the column is an enum of exactly three values.
   */
  it("drops a candidate of a fourth kind rather than storing it", async () => {
    const { profile } = await aShippedRun("questions-fourth-kind@example.com");

    expect(profile.questions.map((question) => question.kind)).not.toContain("date");
    expect(
      profile.questions.some((question) => question.lead.includes("Which year did you graduate?")),
    ).toBe(false);
  });

  /**
   * A fourth kind is impossible at rest, not merely absent from an answer: the column is
   * an enum of exactly three values and PostgreSQL itself refuses a fourth. PGlite is
   * PostgreSQL, so this is the same refusal the deployed cluster makes.
   */
  it("refuses a fourth kind in the database itself", async () => {
    const { sql } = await import("drizzle-orm");
    const { testDb } = await import("../support/database");

    await expect(testDb.execute(sql`select 'scope'::question_kind`)).resolves.toBeDefined();

    // Drizzle wraps the driver's error, so the whole chain is read and not the top
    // message, as `isDuplicate` reads one in the handlers for the same reason.
    const thrown: unknown = await testDb
      .execute(sql`select 'date'::question_kind`)
      .then(() => null)
      .catch((why: unknown) => why);
    const said: string[] = [];
    for (let cause = thrown; cause instanceof Error; cause = cause.cause) said.push(cause.message);
    expect(said.join(" ")).toMatch(/invalid input value for enum question_kind/i);
  });

  /** Criterion 1b: each kind on a real fact of the person's own documents. */
  it("grounds each of the three kinds in a real fact of those documents", async () => {
    const { profile } = await aShippedRun("questions-grounded@example.com");
    const of = (kind: string) => profile.questions.filter((question) => question.kind === kind);

    expect(
      of("scope")
        .map((question) => question.itemTitle)
        .sort(),
    ).toEqual(["Kubernetes", "Observability & Monitoring"]);
    expect(of("conflict").map((question) => question.itemTitle)).toEqual([
      "R&D Collaborator in Software Engineering",
    ]);
    expect(of("provenance").map((question) => question.itemTitle)).toEqual(["Terraform"]);
  });

  it("hangs each question on the item it is about, and that item carries it back", async () => {
    const { profile } = await aShippedRun("questions-on-their-items@example.com");

    const kubernetes = itemNamed(profile, "Kubernetes");
    expect(kubernetes.question?.kind).toBe("scope");
    expect(kubernetes.question?.where).toBe(
      "What you work with · DevOps and cloud · in 2 documents",
    );
    expect(itemNamed(profile, "Docker").question).toBeNull();
  });

  it("carries each question's answers as rows, the last of them the person's own words", async () => {
    const { profile } = await aShippedRun("questions-options@example.com");
    const kubernetes = profile.questions.find((question) => question.itemTitle === "Kubernetes");

    expect(kubernetes?.options.map((option) => option.label)).toEqual([
      "Ran the cluster",
      "Ran services on it",
      "Used it as a developer",
      "Something else",
    ]);
    expect(kubernetes?.options.at(-1)?.concern).toBeNull();
    expect(kubernetes?.options[0]?.concern).toBe(
      "Kubernetes: cluster administration, and the services on it",
    );
  });
});

/**
 * The cases about the writing itself. Each records its own answer through the suite's
 * fixture root, so the product's tree carries only cases that stand for a real reading.
 */
describe("what the run does with what the reader proposed (criteria 2, 3)", () => {
  const twoDocuments = [theSet.cvFrench.filename, theSet.cv2025.filename] as const;

  /** Eleven chips a person really has, so eleven candidates is not an invented shape. */
  const eleven = [
    "Docker",
    "Kubernetes",
    "Helm",
    "Terraform",
    "Ansible",
    "Prometheus",
    "Grafana",
    "OpenTelemetry",
    "Jaeger",
    "JavaScript",
    "TypeScript",
  ];

  const candidateFor = (title: string) => ({
    kind: "scope",
    item: title,
    where: `What you work with · DevOps and cloud · in 1 document`,
    lead: `${title} is in your documents and none of them says your part. Which was it?`,
    options: [
      { label: "Ran it", hint: "operated it", rule: `${title}: operated it` },
      { label: "Used it", hint: "built on it", rule: `${title}: built on it` },
      { label: "Something else", hint: "say it below" },
    ],
  });

  const aRunWith = async (
    email: string,
    cases: Parameters<typeof casesForRun>[0],
  ): Promise<Support.ProfileAnswer> => {
    const person = await signedIn(email);
    await documentsFor(person.id, cases.documents, storage);
    const inPlace = withCases(casesForRun(cases));
    try {
      await (await read(person.cookie)).text();
    } finally {
      inPlace.dispose();
    }
    return profileOf(person.cookie);
  };

  const said = (title: string) => [
    { document: "2026-08-30_cv_FR", said: `DevOps et cloud: ${title}.` },
  ];

  /**
   * The chips under one heading, as the profile really holds them: a chip is an `entry`
   * under a `group`, and the sheet draws no loose entry (`D17`).
   */
  const aGroupOf = (chips: { title: string; from: { document: string; said: string }[] }[]) =>
    aProfileOf([
      {
        kind: "group",
        title: "DevOps and cloud",
        from: said("the group"),
        children: chips.map((chip) => ({ kind: "entry", title: chip.title, from: chip.from })),
      },
    ]);

  it("asks five and writes the rest as waiting against their items", async () => {
    const profile = await aRunWith("questions-capped-at-five@example.com", {
      documents: twoDocuments,
      profile: aGroupOf(eleven.map((title) => ({ title, from: said(title) }))),
      questions: { candidates: eleven.map(candidateFor) },
    });

    expect(profile.questions.length).toBe(5);
    expect(profile.notAsked).toBe(6);
    // Not thrown away: the six sit on their own items, waiting for the builder.
    expect(itemNamed(profile, eleven[10] as string).question).toBeNull();
    expect(profile.questions.map((question) => question.itemTitle)).toEqual(eleven.slice(0, 5));
  });

  /**
   * Criterion 3, `US5`. Four documents that state the same fact in the same words have
   * said it plainly and agree about it, so there is nothing here only the person knows.
   * The rule is the run's, not the fixture's: the answer does propose the question, and
   * the run refuses to write it.
   */
  it("writes no question about a fact four documents agree on and state plainly", async () => {
    const four = [
      theSet.cvFrench.filename,
      theSet.cvEnglish.filename,
      theSet.cv2025.filename,
      theSet.cvWord2022.filename,
    ] as const;
    const agreed = four.map((filename) => ({
      document: filename.slice(0, filename.lastIndexOf(".")),
      said: "Kubernetes",
    }));

    const profile = await aRunWith("questions-agreed-fact@example.com", {
      documents: four,
      profile: aGroupOf([
        { title: "Kubernetes", from: agreed },
        { title: "Terraform", from: said("Terraform") },
      ]),
      questions: { candidates: [candidateFor("Kubernetes"), candidateFor("Terraform")] },
    });

    expect(profile.questions.map((question) => question.itemTitle)).toEqual(["Terraform"]);
    expect(itemNamed(profile, "Kubernetes").question).toBeNull();
  });

  it("writes no question whose item is not in the profile", async () => {
    const profile = await aRunWith("questions-no-such-item@example.com", {
      documents: twoDocuments,
      profile: aGroupOf([{ title: "Kubernetes", from: said("Kubernetes") }]),
      questions: {
        candidates: [candidateFor("Kubernetes"), candidateFor("A thing nobody wrote down")],
      },
    });

    expect(profile.questions.map((question) => question.itemTitle)).toEqual(["Kubernetes"]);
  });

  /**
   * This case used to read "writes no question at all when the answer is malformed, and
   * keeps what was read": a questions pass that answered rubbish cost the questions and
   * nothing else, because the merge had already written the profile in a call of its
   * own. There are no longer two answers to be malformed apart (`ID157`). A candidate
   * the boundary refuses is a reading the boundary refuses, so **nothing at all is
   * written** — and that is not a loss: the documents stay unread, and the next run
   * takes them again.
   */
  it("writes nothing at all when the questions half of the answer is malformed", async () => {
    const profile = await aRunWith("questions-malformed@example.com", {
      documents: twoDocuments,
      raw: JSON.stringify({
        items: aGroupOf([{ title: "Kubernetes", from: said("Kubernetes") }]).items,
        // A candidate with no lead, no where and no options: refused at the boundary.
        candidates: [{ kind: "scope", item: "Kubernetes" }],
      }),
    });

    expect(profile.questions).toEqual([]);
    expect(everyItem(profile).map((item) => item.title)).toEqual([]);
  });

  /**
   * The same restatement for a run whose answer nobody recorded at all. It used to stop
   * after the merge and keep the profile; one call means it stops before anything is
   * written, and every document of the run is left for the next press of the button.
   */
  it("writes nothing at all when the run's reading has no case, and leaves the documents unread", async () => {
    const person = await signedIn("questions-no-case@example.com");
    await documentsFor(person.id, twoDocuments, storage);
    const nothingRecorded = withCases(casesForRun({ documents: twoDocuments }));
    try {
      await (await read(person.cookie)).text();
    } finally {
      nothingRecorded.dispose();
    }

    const profile = await profileOf(person.cookie);
    expect(profile.questions).toEqual([]);
    expect(everyItem(profile).map((item) => item.title)).toEqual([]);

    const listed = (await (
      await app.request("/api/intake/documents", { headers: { cookie: person.cookie } })
    ).json()) as { status: string; readAt: string | null }[];
    expect(listed.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(listed.every((row) => row.readAt === null)).toBe(true);
  });

  /**
   * The reading retries once (spec, *Failure modes*). It used to be the fourth step that
   * retried and this test that counted its calls; the step is gone and the claim is not,
   * so it is counted on the one call the run makes. The first half runs against a
   * fixture root that holds the run's case and the second against one that holds
   * nothing, so what is asserted is that a failure is tried again — once, and no more.
   */
  it("retries the run's one call once before giving up", async () => {
    const runsCase = caseNameFor(twoDocuments);
    const person = await signedIn("questions-retried-once@example.com");
    await documentsFor(person.id, twoDocuments, storage);
    const inPlace = withCases(
      casesForRun({
        documents: twoDocuments,
        profile: aGroupOf([{ title: "Kubernetes", from: said("Kubernetes") }]),
        questions: { candidates: [candidateFor("Kubernetes")] },
      }),
    );
    try {
      await (await read(person.cookie)).text();
    } finally {
      inPlace.dispose();
    }

    expect(
      requestsSent().filter((request) => request.headers["x-jobapp-case"] === runsCase).length,
    ).toBe(1);

    // And when it fails, it is asked twice and no more.
    forgetRequests();
    const other = await signedIn("questions-retried-twice@example.com");
    await documentsFor(other.id, twoDocuments, storage);
    const withoutIt = withCases(casesForRun({ documents: twoDocuments }));
    try {
      await (await read(other.cookie)).text();
    } finally {
      withoutIt.dispose();
    }
    expect(
      requestsSent().filter((request) => request.headers["x-jobapp-case"] === runsCase).length,
    ).toBe(2);
  });
});
