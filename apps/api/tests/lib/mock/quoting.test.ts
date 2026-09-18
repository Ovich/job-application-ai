import { describe, expect, it, vi } from "vitest";
import { type Answer, ModelMock } from "../../../src/lib/mock";
import { openAiWhole } from "../../support/envelopes";

/**
 * Seam: an answer that quotes the request it answers (`ID316`), through `ModelMock.fetch`
 * and nothing else.
 *
 * What is under test is the whole of the mechanism and none of what it is for: a name, an
 * expression with one capture group, and `{{name}}` in the content replaced by what that
 * expression captured out of the last user message. Nothing here knows what a profile, an
 * item or an id is, because the mock does not (`AGENTS.md` rule 6) — the product's use of
 * it is the shipped answers' suite and the reading's.
 */

const said = async (answers: Answer[], ...texts: string[]): Promise<string | null | undefined> => {
  const model = new ModelMock(answers, { pace: "instant" });
  const response = await model.fetch(
    new Request("http://mock.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-case": "asked" },
      body: JSON.stringify({
        model: "m",
        messages: texts.map((content) => ({ role: "user", content })),
      }),
    }),
  );
  return openAiWhole.parse(await response.json()).choices[0]?.message.content;
};

const quietly = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("an answer that quotes the request it answers (ID316)", () => {
  it("replaces {{name}} with what that name's expression captured", async () => {
    expect(
      await said(
        [
          {
            case: "asked",
            quoting: { who: 'my name is "([^"]+)"' },
            content: "Hello, {{who}}.",
          },
        ],
        'my name is "Stefan", and I am asking',
      ),
    ).toBe("Hello, Stefan.");
  });

  it("replaces every placeholder, the same name as often as it appears", async () => {
    expect(
      await said(
        [
          {
            case: "asked",
            quoting: { one: "first=(\\w+)", two: "second=(\\w+)" },
            content: "{{one}} then {{two}}, and {{one}} again.",
          },
        ],
        "first=alpha second=beta",
      ),
    ).toBe("alpha then beta, and alpha again.");
  });

  it("quotes out of the last user message and no earlier one", async () => {
    expect(
      await said(
        [{ case: "asked", quoting: { it: "id=(\\w+)" }, content: "{{it}}" }],
        "id=first",
        "id=second",
      ),
    ).toBe("second");
  });

  it("puts a capture in as it was read, dollars and all", async () => {
    expect(
      await said([{ case: "asked", quoting: { it: "id=(\\S+)" }, content: "<{{it}}>" }], "id=$&$1"),
    ).toBe("<$&$1>");
  });

  /**
   * The failure that matters: a static answer that cannot say back what the request said
   * must not quietly say something else. The placeholder stays, so whatever receives it
   * refuses it, and one line says which answer and which name could not be resolved.
   */
  it("leaves a placeholder whose expression did not match, and says so once", async () => {
    const warn = quietly();
    try {
      expect(
        await said(
          [{ case: "asked", quoting: { it: "id=(\\w+)" }, content: "the item {{it}}." }],
          "nothing of the sort",
        ),
      ).toBe("the item {{it}}.");
      expect(warn).toHaveBeenCalledTimes(1);
      // Named the way a broken answer is named: the file's path, or the inline index.
      expect(warn.mock.calls[0]?.[0]).toContain("answer 0");
      expect(warn.mock.calls[0]?.[0]).toContain("{{it}}");
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves it as it is when the request has no user message at all", async () => {
    const warn = quietly();
    try {
      expect(await said([{ case: "asked", quoting: { it: "id=(\\w+)" }, content: "{{it}}" }])).toBe(
        "{{it}}",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("answers an answer without `quoting` byte for byte, braces included", async () => {
    expect(
      await said([{ case: "asked", content: "nothing is replaced: {{it}}" }], "id=anything"),
    ).toBe("nothing is replaced: {{it}}");
  });
});

describe("what a quoting answer is held to", () => {
  const refused = (quoting: Record<string, string>) => () =>
    new ModelMock([{ case: "asked", quoting, content: "x" }]);

  it("refuses an expression with no capture group, naming the answer and the name", () => {
    expect(refused({ it: "id=\\w+" })).toThrow(/answer 0.*quoting\.it.*no capture group/s);
  });

  it("counts a group that a non-capturing one or an escaped bracket hides", () => {
    expect(refused({ it: "(?:id)=\\(\\w+\\)" })).toThrow(/no capture group/);
    expect(refused({ it: "(?:id)=(\\w+)" })).not.toThrow();
  });

  it("refuses an expression that is not one, naming the answer and the name", () => {
    expect(refused({ it: "id=(" })).toThrow(/answer 0.*quoting\.it.*not a regular expression/s);
  });

  it("refuses a `quoting` that is not names to strings", () => {
    expect(() => new ModelMock([{ case: "asked", quoting: 12 as never, content: "x" }])).toThrow(
      /`quoting` is not a JSON object/,
    );
    expect(
      () => new ModelMock([{ case: "asked", quoting: { it: 12 as never }, content: "x" }]),
    ).toThrow(/`quoting\.it` is not a string/);
  });
});
