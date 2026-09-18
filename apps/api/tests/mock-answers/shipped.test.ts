import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModelMock } from "../../src/lib/mock";
import { mockAnswers } from "../../src/mock-answers";

/**
 * The answers this project ships (`ID295`, `ID292`): every file loads and is reached by
 * what it names, and each of the profile's three replies `answers` the message the agent
 * really sends, built here through the profile definition's own `describe` from the
 * recorded reading's questions rather than copied by hand.
 *
 * `lib/db` is stood in for only because the profile assistant imports it; nothing queries.
 */
vi.mock("../../src/lib/db", async () => ({
  db: (await import("../support/database")).testDb,
}));

const { profileAssistant } = await import("../../src/assistants/profile");
// The two shapes a reading holds a model to, so a recording is held to them too.
const { additions, reading } = await import("../../src/handlers/reading");

type Written = {
  case?: string;
  quoting?: Record<string, string>;
  answers?: string;
  content?: string;
  tool_calls?: { name: string; arguments: unknown }[];
  next?: { content?: string; tool_calls?: unknown[] };
};

const written = (file: string): Written =>
  JSON.parse(readFileSync(join(mockAnswers, file), "utf8")) as Written;

const files = readdirSync(mockAnswers, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replaceAll("\\", "/"))
  .sort();

describe("the answers this project ships", () => {
  /**
   * **One intake case per run, not per document** (`ID157`, `ID158`), each named from the
   * person's real files, by slug, in the run's order (`D20`). There is no LinkedIn export
   * case and no photograph case, and that is not an omission: the person's set holds
   * neither document, and a canned answer standing for no real file is what `D20` forbids.
   */
  it("holds one intake case per run of the person's real documents, and a reply per option of every recorded question", () => {
    expect(files).toEqual([
      "intake/read-more__2026-09-09_cv-en_ownership-application-management.json",
      "intake/read__2026-08-30_cv_EN+2026-08-30_cv_FR.json",
      "intake/read__2026-08-30_cv_EN+2026-09-09_cv-en_ownership-application-management.json",
      "intake/read__2026-08-30_cv_EN.json",
      "intake/read__2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome.json",
      "intake/read__2026-08-30_cv_FR+2026-08-30_cv_EN.json",
      "intake/read__2026-08-30_cv_FR+leCVWeb+CV-2025.json",
      "intake/read__2026-08-30_cv_FR.json",
      "intake/read__leCVWeb+CV-2025.json",
      "profile/charrette-a-personal-project.json",
      "profile/charrette-built-for-this-job-search.json",
      "profile/charrette-work-that-became-open-source.json",
      "profile/ciip-both-the-work-and-the-workloads.json",
      "profile/ciip-developer-engineer.json",
      "profile/ciip-the-workloads-were-mine.json",
      "profile/java-earlier-work.json",
      "profile/java-studies.json",
      "profile/java-the-ciip-platform.json",
      "profile/roster-a-personal-project.json",
      "profile/roster-both-over-time.json",
      "profile/roster-work-at-heig-vd.json",
      "profile/title-both-depending-on-the-application.json",
      "profile/title-keep-rnd-collaborator.json",
      "profile/title-software-engineer-platform.json",
    ]);
    expect(
      files
        .filter((file) => file.startsWith("intake/"))
        .map((file) => written(file).case)
        .sort(),
    ).toEqual([
      "intake.read-more:2026-09-09_cv-en_ownership-application-management",
      "intake.read:2026-08-30_cv_EN",
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR",
      "intake.read:2026-08-30_cv_EN+2026-09-09_cv-en_ownership-application-management",
      "intake.read:2026-08-30_cv_FR",
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN",
      "intake.read:2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome",
      "intake.read:2026-08-30_cv_FR+leCVWeb+CV-2025",
      "intake.read:leCVWeb+CV-2025",
    ]);
    expect(files.filter((file) => /linkedin|export|photo/i.test(file))).toEqual([]);
  });

  it("loads every file, each reached by the case or the message it names", async () => {
    const model = new ModelMock(mockAnswers, { pace: "instant" });
    // An answer that quotes its request (`ID316`) is asked here with no request to quote,
    // so it leaves its placeholders standing and says so. That is the point of this case:
    // the file loads and is reached, whatever it would say to a real run.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (const file of files) {
      const answer = written(file);
      const response = await model.fetch(
        new Request("http://mock.test/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(answer.case === undefined ? {} : { "x-mock-case": answer.case }),
          },
          body: JSON.stringify({
            model: "m",
            messages:
              answer.answers === undefined ? [] : [{ role: "user", content: answer.answers }],
          }),
        }),
      );
      const body = (await response.json()) as { choices: { message: { content: string } }[] };

      // A chain answers its call first, without words (D37).
      expect(body.choices[0]?.message.content).toBe(answer.content ?? "");
    }
    expect(model.requests.map((each) => each.picked)).toEqual(
      files.map((file) => written(file).case ?? file.slice(0, -".json".length)),
    );
    warn.mockRestore();
  });
});

/**
 * The two recordings the walks are made of (SL11, `ID315`, `ID316`, `ID317`).
 *
 * They are held to the very shapes the run holds a model to, imported from the reading
 * itself: a recording that would fail a run fails here first. What they say is the two
 * files' business — both were read out of the person's own PDFs — and what this asserts
 * is that each is an answer its own prompt could have given.
 */
describe("the two readings of the ownership CV (SL11)", () => {
  const walkOne =
    "intake/read__2026-08-30_cv_EN+2026-09-09_cv-en_ownership-application-management.json";
  const walkTwo = "intake/read-more__2026-09-09_cv-en_ownership-application-management.json";

  const answered = (file: string): unknown => JSON.parse(written(file).content ?? "");

  it("reads the first walk's answer under the prompt that creates a profile", () => {
    const answer = reading.parse(answered(walkOne));

    expect(written(walkOne).content).not.toBe("No pre generated text");
    // A profile over two documents: every item of both, and the facts both state carry
    // one source per document.
    expect(answer.items.length).toBeGreaterThan(30);
    expect(answer.items.filter((item) => item.sources.length > 1).length).toBeGreaterThan(15);
    expect(
      new Set(answer.items.flatMap((item) => item.sources.map((source) => source.document))),
    ).toEqual(new Set(["2026-08-30_cv_EN", "2026-09-09_cv-en_ownership-application-management"]));
  });

  it("reads the second walk's answer under the prompt that adds to one", () => {
    const answer = additions.parse(answered(walkTwo));

    expect(written(walkTwo).content).not.toBe("No pre generated text");
    // Both kinds of addition, which is what the walk is for: something the profile does
    // not have at all, and something more on what it has.
    expect(answer.items.length).toBeGreaterThan(0);
    expect(answer.extends.length).toBeGreaterThan(0);
    expect(answer.extends.flatMap((each) => each.lines).length).toBeGreaterThan(0);
    expect(answer.extends.flatMap((each) => each.children).length).toBeGreaterThan(0);
    // Only the second document: a second reading is shown nothing else to cite.
    expect(
      new Set(
        answer.extends.flatMap((each) => [
          ...each.lines.flatMap((line) => line.sources.map((source) => source.document)),
          ...each.children.flatMap((child) => child.sources.map((source) => source.document)),
        ]),
      ),
    ).toEqual(new Set(["2026-09-09_cv-en_ownership-application-management"]));
  });

  /**
   * Every id the second walk names is quoted out of the request (`ID316`), because an id
   * is a `randomUUID` that does not exist until the profile is written: a file that named
   * one would name somebody else's item or nobody's.
   */
  it("names no item id of its own: every one is a placeholder `quoting` fills", () => {
    const quoting = written(walkTwo).quoting ?? {};
    const answer = additions.parse(answered(walkTwo));

    expect(Object.keys(quoting).length).toBe(answer.extends.length);
    for (const each of answer.extends) {
      const name = /^\{\{(\w+)\}\}$/.exec(each.itemId)?.[1];
      expect(name).toBeDefined();
      expect(Object.keys(quoting)).toContain(name);
    }
    // Each one a regular expression with the one capture group the mock requires.
    for (const expression of Object.values(quoting)) {
      expect(new RegExp(`${expression}|`).exec("")).toHaveLength(2);
    }
  });
});

describe("the profile's replies to the preset CV's decisions (ID292)", () => {
  type Candidate = {
    item: string;
    where: string;
    lead: string;
    options: { label: string; hint: string }[];
  };

  const { candidates } = JSON.parse(
    written("intake/read__2026-08-30_cv_EN.json").content ?? "",
  ) as {
    candidates: Candidate[];
  };

  /** The message a pick becomes, worded by the definition from the recorded question. */
  const messageFor = (item: string, label: string): string | null => {
    const question = candidates.find((each) => each.item === item);
    if (question === undefined) throw new Error(`the recorded reading asks nothing about ${item}`);
    // Ids change on every run and are no part of the words: any will do here.
    const options = question.options.map((option, at) => ({
      id: `option-${at}`,
      label: option.label,
      hint: option.hint,
    }));
    return profileAssistant.describe({
      kind: "question_answered",
      lead: question.lead,
      where: question.where,
      options,
      picked: options.find((option) => option.label === label)?.id ?? null,
      words: null,
    });
  };

  it("asks about exactly these three in the recorded reading", () => {
    expect(candidates.map((each) => each.item)).toEqual(["Java", "Roster", "Charrette"]);
  });

  /**
   * The three Java answers are chains (D37): the whole profile read, then the words. The
   * Roster and Charrette answers stay single: words, and no tool call.
   */
  it.each([
    ["Java", "The CIIP platform", "profile/java-the-ciip-platform.json"],
    ["Java", "Earlier work", "profile/java-earlier-work.json"],
    ["Java", "Studies", "profile/java-studies.json"],
  ])(
    "%s answered with `%s` is what %s answers: read_profile with no arguments, then words",
    (item, label, file) => {
      const answer = written(file);

      expect(answer.answers).toBe(messageFor(item, label));
      expect(answer.answers).toContain(`: ${label} (`);
      expect(answer.case).toBeUndefined();
      expect(answer.tool_calls).toEqual([{ name: "read_profile", arguments: {} }]);
      expect(answer.next?.tool_calls ?? []).toEqual([]);
      expect(answer.next?.content?.length).toBeGreaterThan(0);
      expect(answer.next?.content).not.toBe("No pre generated text");
    },
  );

  it.each([
    ["Roster", "Work at HEIG-VD", "profile/roster-work-at-heig-vd.json"],
    ["Roster", "A personal project", "profile/roster-a-personal-project.json"],
    ["Roster", "Both, over time", "profile/roster-both-over-time.json"],
    ["Charrette", "A personal project", "profile/charrette-a-personal-project.json"],
    [
      "Charrette",
      "Work that became open source",
      "profile/charrette-work-that-became-open-source.json",
    ],
    ["Charrette", "Built for this job search", "profile/charrette-built-for-this-job-search.json"],
  ])(
    "%s answered with `%s` is what %s answers, in words and with no tool call",
    (item, label, file) => {
      const answer = written(file);

      expect(answer.answers).toBe(messageFor(item, label));
      expect(answer.answers).toContain(`: ${label} (`);
      expect(answer.case).toBeUndefined();
      expect(answer.tool_calls ?? []).toEqual([]);
      expect(answer.content?.length).toBeGreaterThan(0);
      expect(answer.content).not.toBe("No pre generated text");
    },
  );
});

/**
 * The replies to the second reading's own decisions (`ID320`).
 *
 * A second reading asks its own questions, and until these existed every one of them was
 * answered by the placeholder: the walk `SL11` opened died at its first decision. The
 * questions come from the shipped `read-more` recording, so their wording and their
 * options are fixed, and a reply exists for each option but `Something else`, which is
 * the person's own words and carries no concern of its own.
 */
describe("the profile's replies to the second reading's decisions (ID320)", () => {
  type Candidate = {
    item: string;
    where: string;
    lead: string;
    options: { label: string; hint: string }[];
  };

  const { candidates } = JSON.parse(
    written("intake/read-more__2026-09-09_cv-en_ownership-application-management.json").content ??
      "",
  ) as { candidates: Candidate[] };

  const messageFor = (item: string, label: string): string | null => {
    const question = candidates.find((each) => each.item === item);
    if (question === undefined) throw new Error(`the recorded reading asks nothing about ${item}`);
    const options = question.options.map((option, at) => ({
      id: `option-${at}`,
      label: option.label,
      hint: option.hint,
    }));
    return profileAssistant.describe({
      kind: "question_answered",
      lead: question.lead,
      where: question.where,
      options,
      picked: options.find((option) => option.label === label)?.id ?? null,
      words: null,
    });
  };

  it("asks about exactly these two in the recorded second reading", () => {
    expect(candidates.map((each) => each.item)).toEqual([
      "R&D Collaborator in Software Engineering",
      "CIIP platform",
    ]);
  });

  /** Every option but `Something else` has a reply, and none of them is the placeholder. */
  it.each([
    [
      "R&D Collaborator in Software Engineering",
      "Keep R&D Collaborator in Software Engineering",
      "profile/title-keep-rnd-collaborator.json",
    ],
    [
      "R&D Collaborator in Software Engineering",
      "Software Engineer - Platform Development, Operations and Ownership",
      "profile/title-software-engineer-platform.json",
    ],
    [
      "R&D Collaborator in Software Engineering",
      "Both, depending on the application",
      "profile/title-both-depending-on-the-application.json",
    ],
    ["CIIP platform", "Developer engineer in the team", "profile/ciip-developer-engineer.json"],
    ["CIIP platform", "The workloads were mine", "profile/ciip-the-workloads-were-mine.json"],
    [
      "CIIP platform",
      "Both: the work and the workloads",
      "profile/ciip-both-the-work-and-the-workloads.json",
    ],
  ])("%s answered with `%s` is what %s answers", (item, label, file) => {
    const answer = written(file);

    expect(answer.answers).toBe(messageFor(item, label));
    expect(answer.answers).toContain(`: ${label} (`);
    expect(answer.case).toBeUndefined();
    const words = answer.next?.content ?? answer.content;
    expect(words?.length).toBeGreaterThan(0);
    expect(words).not.toBe("No pre generated text");
  });

  it("leaves `Something else` without a reply, as the person's own words", () => {
    for (const question of candidates) {
      expect(question.options.at(-1)?.label).toBe("Something else");
    }
  });
});

/**
 * Every call the shipped answers write is one the agent would run (D37): the tool is the
 * profile assistant's, and the arguments fit that tool's own input schema, at every link.
 */
describe("the calls the shipped answers write (D37)", () => {
  type Link = { tool_calls?: { name: string; arguments: unknown }[]; next?: Link };

  const callsOf = (link: Link | undefined): { name: string; arguments: unknown }[] =>
    link === undefined ? [] : [...(link.tool_calls ?? []), ...callsOf(link.next)];

  const written = files.flatMap((file) =>
    callsOf(JSON.parse(readFileSync(join(mockAnswers, file), "utf8")) as Link).map(
      (call) => [file, call.name, call.arguments] as const,
    ),
  );

  it("has calls to hold, so the case below cannot pass on nothing", () => {
    expect(written.map(([file, name]) => `${file}: ${name}`)).toEqual([
      "profile/ciip-the-workloads-were-mine.json: read_profile",
      "profile/java-earlier-work.json: read_profile",
      "profile/java-studies.json: read_profile",
      "profile/java-the-ciip-platform.json: read_profile",
      "profile/title-software-engineer-platform.json: read_profile",
    ]);
  });

  it.each(written)("%s calls %s with arguments its input schema parses", (_file, name, args) => {
    const tool = profileAssistant.tools.find((each) => each.name === name);

    expect(tool).toBeDefined();
    expect(tool?.input.safeParse(args).success).toBe(true);
  });
});
