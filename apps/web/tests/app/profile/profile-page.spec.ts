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
 * `ProfilePage`, rendered at its route (D2, `D19`, `ID331`): one column, and nothing that
 * asks anybody anything.
 *
 * Behind it: the routes the viewer calls, stood in for at `fetch`
 * (`tests/support/intake.ts`). What is read is the markup and the signals over a stubbed
 * profile, with no network.
 *
 * Not past it: the viewer's own behaviour and the sheet's own rendering, which their own
 * files hold. The page relayed nine signals between two columns until
 * product-flow-rework `S2.1`; there is one column now, and it holds none.
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

/** Five documents read on a day of its own, and two chips something could be about. */
const aProfile = (questions: Question[], readOn = new Date()): Profile => ({
  ...emptyProfile,
  name: "Stefan Teofanovic",
  documents: 5,
  readOn: readOn.toISOString(),
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
  return { harness, page, at, all, eventually };
};

describe("the profile page (D2, ID331)", () => {
  it("renders the viewer and no assistant, with questions still waiting on the profile", async () => {
    profileIs(aProfile([kubernetes]));
    const { at, harness } = await opened();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(at("profile-viewer")).not.toBeNull();
    expect(at("profile-assistant")).toBeNull();
    expect(at('section[aria-label="Assistant"]')).toBeNull();
    expect(at("scope-tool")).toBeNull();
    // Nothing was asked of the conversation either: the column is not merely hidden.
    expect(
      intakeRequests().filter((each) => each.address.startsWith("/api/conversations/")),
    ).toEqual([]);
  });

  it("draws no assistant before a reading has made a profile either", async () => {
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

  it("says on the bar when the profile was read, as a date and never as a count", async () => {
    profileIs(aProfile([], new Date("2026-09-14T09:30:00.000Z")));
    const { at } = await opened();

    const bar = textOf(at("profile-bar"));
    expect(bar).toContain("Stefan Teofanovic");
    expect(bar).toContain("Read 14 September");
    expect(bar).not.toMatch(/\d+ documents?/);
    expect(bar).not.toContain("From");
  });

  it("is one column at every width: no switch control, and nothing hidden by one", async () => {
    profileIs(aProfile([]));
    const { page, all } = await opened();

    // The toggle is gone, by its handle and by both of its labels.
    expect(all("[data-action=toggle-view]")).toHaveLength(0);
    const labels = all("button")
      .map((each) => textOf(each))
      .filter((each) => each !== "");
    expect(labels).not.toContain("Back to the chat");
    expect(labels).not.toContain("See my profile");

    // One column: the page holds the viewer and nothing beside it, at any width. The
    // grid that put a second column there above 1024 px is gone with its occupant.
    const column = page()?.querySelector("profile-page")?.firstElementChild ?? null;
    expect(Array.from(column?.children ?? []).map((each) => each.tagName.toLowerCase())).toEqual([
      "profile-viewer",
    ]);
    expect(column?.className).not.toMatch(/grid/);
  });
});
