import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import { reset, sentTo, signedInAs } from "../../support/session";

/**
 * The shell at `/profile`, rendered with the AppBar in it (seam E): signed in, the bar
 * shows the initials over an empty page; Sign out asks the library's client for its
 * sign-out and the browser lands on the entry route; a reload after it asks
 * `get-session`, which answers null, and lands there too (US3).
 *
 * Reached through the router with the application's own routes (ID73), so the guard
 * that let the shell render is the real one (seam C), and the library is stood in for
 * at the network by `tests/support/session`. The bar's own states are seam B's.
 */

const stefan = { name: "Stefan Teofanovic", email: "stefan@example.com" };

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the shell", () => {
  beforeEach(() => {
    reset();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  afterEach(() => {
    reset();
  });

  /** `/profile` opened signed in, and what a person can reach on it. */
  const profileOpened = async () => {
    signedInAs({ ...stefan, providers: ["google"] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl("/profile");
    const page = () => harness.routeNativeElement;
    const slot = () =>
      page()?.querySelector<HTMLButtonElement>('button[aria-label="Your account"]');
    const signOutItem = () =>
      Array.from(page()?.querySelectorAll("[role=menu] button") ?? []).find(
        (button) => textOf(button) === "Sign out",
      ) as HTMLButtonElement | undefined;
    return { harness, page, slot, signOutItem };
  };

  it("shows the bar with the initials, and nothing below it", async () => {
    const { page, slot } = await profileOpened();
    await vi.waitFor(() => expect(slot()).not.toBeNull());

    expect(textOf(slot())).toBe("ST");
    expect(page()?.querySelector("main")?.textContent?.trim() ?? "").toBe("");
  });

  it("signs out through the library and lands on the entry route", async () => {
    const { harness, slot, signOutItem } = await profileOpened();
    await vi.waitFor(() => expect(slot()).not.toBeNull());

    slot()?.click();
    harness.detectChanges();
    signOutItem()?.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/"));

    expect(sentTo("sign-out")).toHaveLength(1);
  });

  it("does not restore the session on a reload after signing out", async () => {
    const { harness, slot, signOutItem } = await profileOpened();
    await vi.waitFor(() => expect(slot()).not.toBeNull());
    slot()?.click();
    harness.detectChanges();
    signOutItem()?.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/"));

    await harness.navigateByUrl("/profile");

    expect(TestBed.inject(Router).url).toBe("/");
    expect(sentTo("get-session").length).toBeGreaterThanOrEqual(2);
  });
});
