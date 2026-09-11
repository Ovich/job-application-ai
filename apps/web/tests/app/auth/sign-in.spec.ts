import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSignIn } from "../../../src/app/auth/sign-in/sign-in";
import { reset, sentTo, signedOut } from "../../support/session";

/**
 * The entry route, rendered (seam A): the wordmark, the heading, the sentence, the three
 * provider buttons in D4's order, the fineprint, and nothing else. No password field,
 * because there is nothing to create (D11).
 *
 * What is asserted is what a person sees and does. A press asks the library's own
 * client for that provider's sign-in and names this route as where to come back to on
 * failure (the plan's boundary: no request to `/api/auth/*` is assembled here); while
 * the browser is leaving, the pressed button is busy and the other two are disabled.
 * Back from a failure, the address says which provider did not finish, and the page
 * says so once (D20, one message for every provider). The network is stood in for by
 * `tests/support/session`, whose sign-in answers "nowhere", so the page stays.
 *
 * The head the route sets for a crawler, and the guard that let the route render, are
 * seams D and C: not here. The route is mounted on a test route of its own, so the
 * address can carry what the library or SL4 writes into it.
 */

/** The providers, in the order the buttons stand, and the id each press names (D4). */
const providers = [
  { label: "Continue with Google", id: "google", name: "Google" },
  { label: "Continue with Microsoft", id: "microsoft", name: "Microsoft" },
  { label: "Continue with LinkedIn", id: "linkedin", name: "LinkedIn" },
];

const heading = "Your job application in the era of AI";
const sentence = "A tailored CV and cover letter for every job offer. Let the silence stop.";
const fineprint = "What we keep, and how to delete it";

/** The page's text, one space between words, the way a screen reader would say it. */
const textOf = (element: HTMLElement | null): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The page's characters with no whitespace at all: what it says, whatever the markup between. */
const lettersOf = (text: string): string => text.replace(/\s+/g, "");

const buttonsOf = (element: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(element?.querySelectorAll("button") ?? []);

const buttonNamed = (element: HTMLElement | null, label: string): HTMLButtonElement => {
  const button = buttonsOf(element).find((candidate) => textOf(candidate) === label);
  if (button === undefined) {
    throw new Error(`no button reads "${label}"`);
  }
  return button;
};

describe("the entry route", () => {
  beforeEach(() => {
    reset();
    signedOut();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: "", component: AppSignIn }])],
    });
  });

  afterEach(() => {
    reset();
  });

  /** The route rendered at `address`, as the element a person sees. */
  const opened = async (address = "/"): Promise<HTMLElement | null> => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(address, AppSignIn);
    return harness.routeNativeElement;
  };

  it("shows the wordmark, the heading, the sentence, the three buttons and the fineprint, in that order and nothing else", async () => {
    const page = await opened();

    expect(lettersOf(textOf(page))).toBe(
      lettersOf(
        [
          "job-application.app",
          heading,
          sentence,
          ...providers.map(({ label }) => label),
          fineprint,
        ].join(" "),
      ),
    );
    expect(page?.querySelector("h1")?.textContent?.trim()).toBe(heading);
    expect(buttonsOf(page).map(textOf)).toEqual(providers.map(({ label }) => label));
    expect(page?.querySelector("input")).toBeNull();
  });

  it.each(providers)(
    'asks the library to sign in with $id when "$label" is pressed, naming this route for a failure',
    async ({ label, id }) => {
      const page = await opened();

      buttonNamed(page, label).click();
      await vi.waitFor(() => expect(sentTo("sign-in/social")).toHaveLength(1));

      expect(sentTo("sign-in/social")[0]).toMatchObject({
        method: "POST",
        body: { provider: id, callbackURL: "/", errorCallbackURL: `/?failed=${id}` },
      });
    },
  );

  it("marks the pressed button busy and disables the other two while the browser leaves", async () => {
    const page = await opened();

    buttonNamed(page, "Continue with Microsoft").click();
    await vi.waitFor(() => expect(sentTo("sign-in/social")).toHaveLength(1));

    const [google, microsoft, linkedin] = buttonsOf(page);
    expect(microsoft?.getAttribute("aria-busy")).toBe("true");
    expect(google?.disabled).toBe(true);
    expect(linkedin?.disabled).toBe(true);
    expect(google?.getAttribute("aria-busy")).not.toBe("true");
    expect(linkedin?.getAttribute("aria-busy")).not.toBe("true");
  });

  it("shows no notice when nothing failed", async () => {
    const page = await opened();

    expect(page?.querySelector("[role=alert], [role=status]")).toBeNull();
  });

  it.each(providers)(
    "says $name did not finish signing you in when the address says so",
    async ({ id, name }) => {
      const page = await opened(`/?failed=${id}&error=access_denied`);

      const notices = Array.from(page?.querySelectorAll("[role=alert]") ?? []);
      expect(notices).toHaveLength(1);
      expect(textOf(notices[0] as HTMLElement)).toBe(
        `${name} did not finish signing you in. Nothing was created and nothing was charged. Try again, or continue with another account.`,
      );
    },
  );

  it("says the account is deleted when the address says so", async () => {
    const page = await opened("/?deleted");

    const notices = Array.from(page?.querySelectorAll("[role=status]") ?? []);
    expect(notices).toHaveLength(1);
    expect(textOf(notices[0] as HTMLElement)).toBe(
      "Your account is deleted. Everything it held is gone. You are welcome back any time, from nothing.",
    );
    expect(page?.querySelector("[role=alert]")).toBeNull();
  });
});
