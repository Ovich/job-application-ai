import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import {
  documentsAre,
  emptyProfile,
  intakeRequests,
  itemOf,
  type Profile,
  profileIs,
  type Question,
  questionOf,
  resetIntake,
  rowOf,
} from "../../support/intake";
import { reset, signedInAs } from "../../support/session";

/**
 * `ProfilePage`, rendered at its route (D2, D8): the layout, and the relays between its two
 * sections, `ProfileViewer` on the right and `ProfileAssistant` on the left.
 *
 * Behind it: the routes both sections call, stood in for at `fetch`
 * (`tests/support/intake.ts`). What is read is what a person sees in one section after
 * something happened in the other.
 *
 * Not past it: either section's own behaviour, which their own files hold.
 */

const person = {
  name: "Stefan Teofanovic",
  email: "stefan@example.com",
  providers: ["google" as const],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

const kubernetes = questionOf({
  id: "q1",
  itemId: "chip-k8s",
  itemTitle: "Kubernetes",
  lead: "Which was it?",
});

/** Five documents read today, and two chips a question can be about. */
const aProfile = (questions: Question[]): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 5,
  readOn: new Date().toISOString(),
  groups: [
    itemOf({
      id: "group-devops",
      kind: "group",
      title: "DevOps and cloud",
      children: [
        itemOf({
          id: "chip-k8s",
          kind: "entry",
          title: "Kubernetes",
          entry: { label: "Kubernetes", qualifier: null },
        }),
        itemOf({
          id: "chip-docker",
          kind: "entry",
          title: "Docker",
          entry: { label: "Docker", qualifier: null },
        }),
      ],
    }),
  ],
  questions,
});

beforeEach(() => {
  reset();
  resetIntake();
  signedInAs(person);
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
});

afterEach(() => {
  reset();
  resetIntake();
});

const opened = async () => {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl("/profile");
  const page = () => harness.routeNativeElement;
  const at = (selector: string) => page()?.querySelector(selector) ?? null;
  const all = (selector: string) => Array.from(page()?.querySelectorAll(selector) ?? []);
  const eventually = (assert: () => void) =>
    vi.waitFor(() => {
      harness.detectChanges();
      assert();
    });
  await eventually(() => expect(at("profile-sheet")).not.toBeNull());
  return { harness, at, all, eventually };
};

describe("the profile page (D2, D8)", () => {
  it("draws no assistant section before a reading has made a profile", async () => {
    profileIs(emptyProfile);
    documentsAre([rowOf({ id: "document-1", filename: "2026-08-30_cv_EN.pdf" })]);
    const { at, harness } = await opened();
    await vi.waitFor(() =>
      expect(intakeRequests()).toContainEqual({ method: "GET", address: "/api/intake/documents" }),
    );
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(at('section[aria-label="Assistant"]')).toBeNull();
    expect(at("profile-assistant")).toBeNull();
  });

  it("turns the assistant's tool on for the region pressed in the viewer", async () => {
    profileIs(aProfile([]));
    const { at, eventually } = await opened();
    await eventually(() => expect(at("profile-assistant [data-part=done]")).not.toBeNull());

    (at('[data-region][data-id="chip-docker"]') as HTMLElement | null)?.click();

    await eventually(() =>
      expect(textOf(at("profile-assistant scope-tool [data-part=lead]"))).toBe(
        "Tell me what I should know about it, in your own words.",
      ),
    );
    expect(textOf(at("profile-assistant composer [data-part=where]"))).toBe("Docker");
  });

  it("reads the profile back in the viewer once the assistant's decision is kept", async () => {
    profileIs(aProfile([kubernetes]));
    const { at, all, eventually } = await opened();
    await eventually(() => expect(all("profile-assistant [data-action=alt]")).toHaveLength(4));

    (all("profile-assistant [data-action=alt]")[0] as HTMLButtonElement).click();
    await eventually(() =>
      expect((at("[data-part=send]") as HTMLButtonElement | null)?.disabled).toBe(false),
    );
    (at("[data-part=send]") as HTMLButtonElement).click();

    await eventually(() =>
      expect(textOf(at('[data-region][data-id="chip-k8s"] [data-part=concern]'))).toBe(
        "✓ Kubernetes: cluster administration, and the services on it",
      ),
    );
    expect(
      intakeRequests().filter(
        (each) => each.method === "GET" && each.address === "/api/intake/profile",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows one section at a time below 1024 px, and the bar's toggle switches which", async () => {
    profileIs(aProfile([]));
    const { at, all, eventually } = await opened();
    const assistant = () => at('section[aria-label="Assistant"]');
    const toggle = (label: string) =>
      all("profile-bar button").find((each) => textOf(each) === label) as HTMLButtonElement;
    await eventually(() => expect(assistant()).not.toBeNull());
    expect(assistant()?.classList.contains("hidden")).toBe(true);

    toggle("Back to the chat").click();

    await eventually(() => expect(at("[data-view]")?.getAttribute("data-view")).toBe("chat"));
    expect(assistant()?.classList.contains("hidden")).toBe(false);

    toggle("See my profile").click();

    await eventually(() => expect(assistant()?.classList.contains("hidden")).toBe(true));
  });
});
