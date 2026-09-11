import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "../../../src/app/auth/sign-in";

/**
 * The bare entry: one button per provider, "Continue with Google", "Continue with
 * Microsoft", "Continue with LinkedIn", and what pressing each does.
 *
 * What is asserted is the one thing this application decides: that the press reaches
 * the library's own sign-in route, for the provider the button names, through the
 * library's own client (the plan's boundary: no request to `/api/auth/*` is assembled
 * here). Where the browser goes next is the library's answer to that request, and the
 * network is stood in for, so the answer here says "nowhere" and the page stays.
 *
 * The designed entry route is SL3's; these are the buttons that prove US1 and US2 on
 * localhost (SL1 put the first there, SL2 the other two).
 */

/** The providers, in the order the buttons stand, and the id each press names (D4). */
const providers = [
  { label: "Continue with Google", id: "google" },
  { label: "Continue with Microsoft", id: "microsoft" },
  { label: "Continue with LinkedIn", id: "linkedin" },
];

type Fetching = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Stands in for the network and keeps what was handed to it. Installed before any
 * import runs, because the library's client takes the platform's `fetch` once, when it
 * is built — the same seam S5.3 hands the payload-hash fetch through (ID58) — so a
 * stand-in put in place after the client exists is never called.
 */
const fetching = vi.hoisted(() => {
  const fetching = vi.fn<Fetching>();
  vi.stubGlobal("fetch", fetching);
  return fetching;
});

/** The one request that left, as its address, its method and its parsed body. */
function requestSentTo() {
  const [input, init] = fetching.mock.calls[0] ?? [];
  const address =
    input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  return { address, method: init?.method, body };
}

describe("the sign-in page", () => {
  beforeEach(() => {
    fetching.mockReset();
    fetching.mockImplementation(
      async () => new Response(JSON.stringify({ url: null, redirect: false }), { status: 200 }),
    );
    TestBed.configureTestingModule({ imports: [SignIn] });
  });

  afterEach(() => {
    fetching.mockReset();
  });

  it("offers one button per provider, and nothing else", () => {
    const fixture = TestBed.createComponent(SignIn);
    fixture.detectChanges();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("button"),
    ).map((button) => button.textContent?.trim());

    expect(buttons).toEqual(providers.map(({ label }) => label));
  });

  it.each(providers)(
    'asks the library to sign in with $id when "$label" is pressed',
    async ({ label, id }) => {
      const fixture = TestBed.createComponent(SignIn);
      fixture.detectChanges();

      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === label)
        ?.click();
      await vi.waitFor(() => expect(fetching).toHaveBeenCalled());

      const { address, method, body } = requestSentTo();
      expect(address).toContain("/api/auth/sign-in/social");
      expect(method).toBe("POST");
      expect(body).toMatchObject({ provider: id });
    },
  );
});
