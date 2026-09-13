import { describe, expect, it } from "vitest";
import { answeringOwnAddress } from "../../../src/lib/ai/own-address";

/**
 * Which of two ways a call goes, and on what grounds.
 *
 * The deployed function is configured with a base URL that is an address of this very
 * application, and a call put on a socket there leaves the function, crosses the
 * distribution and invokes the same function again. Until this seam was filled the
 * deployed function was configured with no base URL at all, fell back to a local one,
 * and dialled a port nothing was listening on — every document came back unread, and
 * every one of those failures was swallowed by a bare `catch`.
 *
 * What is asserted is the grounds of the decision and nothing else: the origin, not the
 * path, not the scheme in isolation, and never which environment this is. A base URL
 * that names anywhere else is dialled, which is what keeps pointing it at a provider a
 * change of configuration rather than of code.
 */

const answered = new Response("answered in this process");
const dialled = new Response("put on the wire");

const both = (origin: string) => {
  const went: string[] = [];
  const fetch = answeringOwnAddress({
    origin,
    answer: async (request) => {
      went.push(`answer ${request.url}`);
      return answered.clone();
    },
    otherwise: async (input) => {
      went.push(`otherwise ${String(input)}`);
      return dialled.clone();
    },
  });
  return { fetch, went };
};

const ours = "https://dev.job-application.app";

describe("a call to this application's own address", () => {
  it("is answered in this process, and never put on the wire", async () => {
    const { fetch, went } = both(ours);

    const answer = await fetch(`${ours}/mock/v1/chat/completions`, { method: "POST", body: "{}" });

    expect(await answer.text()).toBe("answered in this process");
    expect(went).toEqual([`answer ${ours}/mock/v1/chat/completions`]);
  });

  it("reaches the handler as the request a server would have been sent", async () => {
    const seen: { method?: string; header?: string | null; body?: string } = {};
    const fetch = answeringOwnAddress({
      origin: ours,
      answer: async (request) => {
        seen.method = request.method;
        seen.header = request.headers.get("X-Jobapp-Case");
        seen.body = await request.text();
        return answered.clone();
      },
      otherwise: async () => dialled.clone(),
    });

    await fetch(`${ours}/mock/v1/chat/completions`, {
      method: "POST",
      headers: { "X-Jobapp-Case": "intake.read:2026-08-30_cv_FR" },
      body: '{"model":"a-model"}',
    });

    expect(seen).toEqual({
      method: "POST",
      header: "intake.read:2026-08-30_cv_FR",
      body: '{"model":"a-model"}',
    });
  });
});

describe("a call to any other address", () => {
  it("is put on the wire, whoever is behind it", async () => {
    const { fetch, went } = both(ours);

    const answer = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST" });

    expect(await answer.text()).toBe("put on the wire");
    expect(went).toEqual(["otherwise https://api.openai.com/v1/chat/completions"]);
  });

  it("is decided by the origin, so the same host on another port is not ours", async () => {
    const { went } = both("http://localhost:4200");
    const { fetch } = both("http://localhost:4200");

    await fetch("http://localhost:3000/mock/v1/chat/completions");

    expect(went).toEqual([]);
  });

  it("is decided by the origin alone, whatever the path", async () => {
    const { fetch, went } = both(ours);

    await fetch(`${ours}/api/intake/read`);

    expect(went).toEqual([`answer ${ours}/api/intake/read`]);
  });
});
