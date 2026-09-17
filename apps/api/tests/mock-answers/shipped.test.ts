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

type Written = { case?: string; answers?: string; content: string; tool_calls?: unknown[] };

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
  it("holds one intake case per run of the person's real documents, and the profile's three replies", () => {
    expect(files).toEqual([
      "intake/read__2026-08-30_cv_EN+2026-08-30_cv_FR.json",
      "intake/read__2026-08-30_cv_EN.json",
      "intake/read__2026-08-30_cv_FR+2026-08-30_cv_EN+BS-HEIGVD-IL-Diplome.json",
      "intake/read__2026-08-30_cv_FR+2026-08-30_cv_EN.json",
      "intake/read__2026-08-30_cv_FR+leCVWeb+CV-2025.json",
      "intake/read__2026-08-30_cv_FR.json",
      "intake/read__leCVWeb+CV-2025.json",
      "profile/charrette-built-for-this-job-search.json",
      "profile/java-earlier-work.json",
      "profile/roster-both-over-time.json",
    ]);
    expect(
      files
        .filter((file) => file.startsWith("intake/"))
        .map((file) => written(file).case)
        .sort(),
    ).toEqual([
      "intake.read:2026-08-30_cv_EN",
      "intake.read:2026-08-30_cv_EN+2026-08-30_cv_FR",
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

      expect(body.choices[0]?.message.content).toBe(answer.content);
    }
    expect(model.requests.map((each) => each.picked)).toEqual(
      files.map((file) => written(file).case ?? file.slice(0, -".json".length)),
    );
  });
});

describe("the profile's replies to the preset CV's decisions (ID292)", () => {
  type Candidate = {
    item: string;
    where: string;
    lead: string;
    options: { label: string; hint: string }[];
  };

  const { candidates } = JSON.parse(written("intake/read__2026-08-30_cv_EN.json").content) as {
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

  it.each([
    ["Java", "Earlier work", "profile/java-earlier-work.json"],
    ["Roster", "Both, over time", "profile/roster-both-over-time.json"],
    ["Charrette", "Built for this job search", "profile/charrette-built-for-this-job-search.json"],
  ])(
    "%s answered with `%s` is what %s answers, in words and with no tool call",
    (item, label, file) => {
      const answer = written(file);

      expect(answer.answers).toBe(messageFor(item, label));
      expect(answer.answers).toContain(`: ${label} (`);
      expect(answer.case).toBeUndefined();
      expect(answer.tool_calls ?? []).toEqual([]);
      expect(answer.content.length).toBeGreaterThan(0);
      expect(answer.content).not.toBe("No pre generated text");
    },
  );
});
