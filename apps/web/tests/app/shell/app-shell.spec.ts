import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../../src/app/app.routes";
import type { Provider } from "../../../src/app/auth/session";
import { resetIntake } from "../../support/intake";
import { failing, reset, sentTo, signedInAs, signedOut, unreachable } from "../../support/session";

/**
 * The shell at `/profile`, rendered with the AppBar in it (seam E): signed in, the bar
 * shows the initials over an empty page; Sign out asks the library's client for its
 * sign-out and the browser lands on the entry route; a reload after it asks
 * `get-session`, which answers null, and lands there too (US3).
 *
 * Reached through the router with the application's own routes (ID73), so the guard
 * that let the shell render is the real one (seam C), and the library is stood in for
 * at the network by `tests/support/session`. The bar's own states are seam B's.
 *
 * SL4 extends it (its seam B): Delete my account opens the confirm gate where the menu
 * was, with the shell's deletion body in it, and the gate's confirmation asks the
 * library's client for `delete-user`. The gate's own states are its seam C; what the
 * entry route shows at `/?deleted` is SL3's; the deletion itself is the API's seam A.
 */

const stefan = { name: "Stefan Teofanovic", email: "stefan@example.com" };

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the shell", () => {
  beforeEach(() => {
    reset();
    // SL3 filled the outlet: `/profile` now loads the viewer, which asks the intake
    // for the profile the moment it is created. The stand-in answers an empty one.
    resetIntake();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  afterEach(() => {
    reset();
    resetIntake();
  });

  /** `/profile` opened signed in, and what a person can reach on it. */
  const profileOpened = async (providers: Provider[] = ["google"]) => {
    signedInAs({ ...stefan, providers });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl("/profile");
    const page = () => harness.routeNativeElement;
    const slot = () =>
      page()?.querySelector<HTMLButtonElement>('button[aria-label="Your account"]');
    const signOutItem = () =>
      Array.from(page()?.querySelectorAll("[role=menu] button") ?? []).find(
        (button) => textOf(button) === "Sign out",
      ) as HTMLButtonElement | undefined;
    const menuItem = (label: string) =>
      Array.from(page()?.querySelectorAll("[role=menu] button") ?? []).find(
        (button) => textOf(button) === label,
      ) as HTMLButtonElement | undefined;
    const gate = () => page()?.querySelector<HTMLElement>("[role=dialog]") ?? null;
    const gateButton = (label: string) =>
      Array.from(gate()?.querySelectorAll("button") ?? []).find(
        (button) => textOf(button) === label,
      ) as HTMLButtonElement | undefined;
    /** The code as the gate shows it: the one element whose whole text is a code. */
    const shownCode = () =>
      Array.from(gate()?.querySelectorAll("*") ?? [])
        .map(textOf)
        .find((text) => /^[A-Z0-9]{8}$/.test(text)) ?? "";
    /** Signed in, `/profile` rendered, the menu opened and Delete my account pressed. */
    const deleteMyAccount = async () => {
      await vi.waitFor(() => expect(slot()).not.toBeNull());
      slot()?.click();
      harness.detectChanges();
      menuItem("Delete my account")?.click();
      harness.detectChanges();
    };
    /** The warning read, Acknowledge pressed: the code and its field appear (ID95). */
    const acknowledge = () => {
      const button = gateButton("Acknowledge");
      if (button === undefined) {
        throw new Error("no Acknowledge in the gate");
      }
      button.click();
      harness.detectChanges();
    };
    const typeTheCode = () => {
      const field = gate()?.querySelector("input");
      if (field === null || field === undefined) {
        throw new Error("no field in the gate");
      }
      field.value = shownCode();
      field.dispatchEvent(new Event("input", { bubbles: true }));
      harness.detectChanges();
    };
    return {
      harness,
      page,
      slot,
      signOutItem,
      menuItem,
      gate,
      gateButton,
      shownCode,
      deleteMyAccount,
      acknowledge,
      typeTheCode,
    };
  };

  it("shows the bar with the initials, and the viewer below it", async () => {
    const { page, slot } = await profileOpened();
    await vi.waitFor(() => expect(slot()).not.toBeNull());

    expect(textOf(slot())).toBe("ST");
    // Empty since the foundation, and this is the slice that filled it (SL3).
    expect(page()?.querySelector("main profile-viewer")).not.toBeNull();
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

  describe("Delete my account (US5)", () => {
    it("opens the gate where the menu was, a line per linked provider in the order linked, and the money callout", async () => {
      const shell = await profileOpened(["linkedin", "microsoft"]);

      await shell.deleteMyAccount();
      await vi.waitFor(() => expect(shell.gate()).not.toBeNull());

      expect(shell.page()?.querySelector("[role=menu]")).toBeNull();
      const text = textOf(shell.gate());
      expect(text).toContain("Delete your account?");
      expect(text).toContain(
        "This permanently deletes your account and everything in it. It cannot be undone, and nothing can be recovered, by you or by us.",
      );
      const stakes = Array.from(shell.gate()?.querySelectorAll("li") ?? []).map(textOf);
      expect(stakes).toEqual([
        "Your sign-in with LinkedIn goes. Your LinkedIn account itself is not touched.",
        "Your sign-in with Microsoft goes. Your Microsoft account itself is not touched.",
      ]);
      const callout = shell.gate()?.querySelector("app-notice[role=note]");
      expect(textOf(callout)).toBe(
        "Your membership is cancelled. Credits you have left are not refunded.",
      );
      expect(shell.shownCode()).toBe("");
      expect(shell.gateButton("Acknowledge")).not.toBeUndefined();

      shell.acknowledge();

      expect(textOf(shell.gate())).toContain("Your membership is cancelled.");
      expect(shell.shownCode()).toMatch(/^[A-Z0-9]{8}$/);
      expect(shell.gateButton("Delete account")?.disabled).toBe(true);
    });

    it("closes the gate on Cancel and sends nothing to delete-user", async () => {
      const shell = await profileOpened();
      await shell.deleteMyAccount();
      await vi.waitFor(() => expect(shell.gate()).not.toBeNull());

      shell.gateButton("Cancel")?.click();
      shell.harness.detectChanges();

      await vi.waitFor(() => expect(shell.gate()).toBeNull());
      expect(sentTo("delete-user")).toHaveLength(0);
      expect(TestBed.inject(Router).url).toBe("/profile");
    });

    it("deletes through the library once the shown code is typed, and lands on the entry route's note", async () => {
      const shell = await profileOpened();
      await shell.deleteMyAccount();
      await vi.waitFor(() => expect(shell.gate()).not.toBeNull());

      shell.acknowledge();
      shell.typeTheCode();
      shell.gateButton("Delete account")?.click();

      // The router writes an empty query value out as `deleted=`; the entry route reads
      // whether the address has `deleted` (F8), so that is what is asked of it here.
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/?deleted="));
      expect(sentTo("delete-user")).toHaveLength(1);
      expect(sentTo("delete-user")[0]?.method).toBe("POST");
    });

    it("keeps the gate open, says nothing was deleted and stays on /profile when delete-user fails", async () => {
      const shell = await profileOpened();
      failing("delete-user", 500);
      await shell.deleteMyAccount();
      await vi.waitFor(() => expect(shell.gate()).not.toBeNull());
      shell.acknowledge();
      const code = shell.shownCode();

      shell.typeTheCode();
      shell.gateButton("Delete account")?.click();

      await vi.waitFor(() =>
        expect(textOf(shell.gate())).toContain(
          "Nothing was deleted. The deletion did not go through. Try again in a moment.",
        ),
      );
      expect(shell.gate()?.querySelector("app-notice[role=alert]")).not.toBeNull();
      expect(sentTo("delete-user")).toHaveLength(1);
      expect(TestBed.inject(Router).url).toBe("/profile");
      expect(shell.shownCode()).toBe(code);
      expect(shell.gate()?.querySelector("input")?.value).toBe(code);
      expect(shell.gateButton("Delete account")?.disabled).toBe(false);
    });

    it("goes to the entry route, and opens no gate, when there is no session any more", async () => {
      const shell = await profileOpened();
      await vi.waitFor(() => expect(shell.slot()).not.toBeNull());
      signedOut();

      await shell.deleteMyAccount();

      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/"));
      expect(shell.gate()).toBeNull();
      expect(sentTo("delete-user")).toHaveLength(0);
    });

    it("goes to the entry route, and opens no gate, when the library cannot be reached", async () => {
      const shell = await profileOpened();
      await vi.waitFor(() => expect(shell.slot()).not.toBeNull());
      unreachable();

      await shell.deleteMyAccount();

      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe("/"));
      expect(shell.gate()).toBeNull();
      expect(sentTo("delete-user")).toHaveLength(0);
    });
  });
});
