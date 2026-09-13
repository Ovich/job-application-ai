import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * That the application actually hands `lib/ai` the thing it needs, and not only that it
 * could.
 *
 * The seam existed before this test did: `AiConfig` took a `fetch`, its own comment said
 * it was "how the deployed function answers itself with no network hop", `app.ts` said
 * the function "is handed an in-process dispatch as a value at its composition root",
 * and **nothing handed it anything**. The deployed function therefore fell back to a
 * base URL naming a laptop's own port, dialled it, found nothing listening, and marked
 * every one of the person's documents unreadable — silently, because both failure paths
 * swallow what they catch.
 *
 * A unit test of the decision would not have caught that, and there is one beside this
 * (`own-address.test.ts`): it proves the rule, given the parts. This proves the parts
 * are joined. It imports the application the way a runtime does and then asks the
 * boundary for an answer at that application's own address, with no port open anywhere.
 */

const cvFr = "intake.read:2026-08-30_cv_FR" as const;
const ours = "http://api.test";

/**
 * The boundary as a runtime meets it: the application imported first, so its composition
 * root has run, and `lib/ai` configured with an address that is the application's own.
 */
const bootedWith = async (baseUrl: string) => {
  vi.resetModules();
  vi.stubEnv("APP_URL", ours);
  vi.stubEnv("AI_BASE_URL", baseUrl);
  // The entry point's first act, and the reason this import is not unused: loading it is
  // what runs the composition root.
  await import("../../../src/app");
  return await import("../../../src/lib/ai");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the composition root", () => {
  it("hands lib/ai the application, so its own address is answered with no port open", async () => {
    const ai = await bootedWith(`${ours}/mock/v1`);

    const answer = await ai.ask([{ role: "user", content: "read this" }], {
      feature: "intake",
      step: "read",
      input: "2026-08-30_cv_FR",
    });

    // The answer this application ships for that case, asked for by name and read from
    // the tree beside it. Asserted on its shape rather than its wording: what is under
    // test is that the call arrived and was answered here, not what the answer says.
    const read = JSON.parse(answer) as { items?: unknown[] };
    expect(Array.isArray(read.items)).toBe(true);
    expect(answer).toContain(cvFr.slice(cvFr.indexOf(":") + 1));
  });

  it("leaves an address that is not the application's to the wire", async () => {
    // Nothing listens there, and nothing may be dialled in this suite, so the call
    // failing to connect is the assertion: it was not answered in process.
    const ai = await bootedWith("http://127.0.0.1:9/v1");

    await expect(
      ai.ask([{ role: "user", content: "read this" }], {
        feature: "intake",
        step: "read",
        input: "2026-08-30_cv_FR",
      }),
    ).rejects.toThrow();
  });
});
