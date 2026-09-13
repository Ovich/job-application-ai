import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routes } from "../../../src/app/app.routes";
import { CurrentUser } from "../../../src/app/auth/current-user";
import { itemOf, profileIs, resetIntake } from "../../support/intake";
import { failing, reset, sentTo, signedInAs, signedOut, unreachable } from "../../support/session";

/**
 * The person signed in (ID74, ID99): `CurrentUser`, the one place that asks the library
 * who it is, signs out, deletes, and sends the browser where each of those leads. The
 * session cookie is HttpOnly, so "signed in" is only ever what the library's
 * `get-session` answers at that moment, and the service remembers what it last heard as
 * a signal, `person`.
 *
 * The service is asked through the application's injector with its own routes (ID73), so
 * where it sends the browser is the router's real answer; the two guards are reached
 * through the router, never called, since where a browser lands is all a person sees of
 * a guard. The library is stood in for at the network by `tests/support/session`.
 */

const stefan = { name: "Stefan Teofanovic", email: "stefan@example.com" };

describe("CurrentUser", () => {
  beforeEach(() => {
    reset();
    // `/profile` loads the viewer, and a profile with nothing in it now leaves for
    // `/documents` (the person, 2026-09-12). These cases are about the session and the
    // deletion gate, so the person they sign in as has something read.
    resetIntake();
    profileIs({ summary: itemOf({ id: "summary", kind: "summary", title: "Someone." }) });
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  afterEach(() => {
    reset();
    resetIntake();
  });

  const currentUser = () => TestBed.inject(CurrentUser);
  const url = () => TestBed.inject(Router).url;

  /** The browser on `/profile`, signed in as `providers` would have it. */
  const onProfile = async (providers: ("google" | "microsoft" | "linkedin")[] = ["google"]) => {
    signedInAs({ ...stefan, providers });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl("/profile");
    return harness;
  };

  describe("who is signed in", () => {
    it("answers null when the library has no session, and holds no person", async () => {
      signedOut();

      await expect(currentUser().refresh()).resolves.toBeNull();
      expect(currentUser().person()).toBeNull();
    });

    it("answers the name, the address and the linked provider, and holds them as the person", async () => {
      signedInAs({ ...stefan, providers: ["google"] });

      await expect(currentUser().refresh()).resolves.toEqual({ ...stefan, providers: ["google"] });
      expect(currentUser().person()).toEqual({ ...stefan, providers: ["google"] });
    });

    it("lists two linked providers in the order they were linked, oldest first", async () => {
      signedInAs({ ...stefan, providers: ["linkedin", "google"] });

      await expect(currentUser().refresh()).resolves.toEqual({
        ...stefan,
        providers: ["linkedin", "google"],
      });
    });

    it("answers what the library answers now, so a sign-out is seen by the next call", async () => {
      signedInAs({ ...stefan, providers: ["google"] });
      await expect(currentUser().refresh()).resolves.not.toBeNull();

      signedOut();

      await expect(currentUser().refresh()).resolves.toBeNull();
    });

    it("asks the library nothing but who am I and which accounts", async () => {
      signedInAs({ ...stefan, providers: ["google"] });

      await currentUser().refresh();

      expect(sentTo("get-session")).toHaveLength(1);
      expect(sentTo("list-accounts")).toHaveLength(1);
    });

    it("rejects when the library cannot be reached, which is not the same as no session", async () => {
      unreachable();

      await expect(currentUser().refresh()).rejects.toThrow();
    });
  });

  describe("the guards, through the router", () => {
    /** Where the browser is after opening `urls`: one harness per test, as the router asks. */
    const landingAfter = async (...urls: string[]): Promise<string[]> => {
      const harness = await RouterTestingHarness.create();
      const landed: string[] = [];
      for (const each of urls) {
        await harness.navigateByUrl(each);
        landed.push(url());
      }
      return landed;
    };

    it("sends a signed-out browser from /profile to the entry route", async () => {
      signedOut();

      expect(await landingAfter("/profile")).toEqual(["/"]);
    });

    it("sends a signed-in browser from / to /profile", async () => {
      signedInAs({ ...stefan, providers: ["google"] });

      expect(await landingAfter("/")).toEqual(["/profile"]);
    });

    it("lets a signed-out browser see the entry route", async () => {
      signedOut();

      expect(await landingAfter("/")).toEqual(["/"]);
    });

    it("lets a signed-in browser see /profile, the person held", async () => {
      signedInAs({ ...stefan, providers: ["google"] });

      expect(await landingAfter("/profile")).toEqual(["/profile"]);
      expect(currentUser().person()?.name).toBe(stefan.name);
    });

    it("treats a library that cannot be reached as no session, on both routes", async () => {
      unreachable();

      expect(await landingAfter("/profile", "/")).toEqual(["/", "/"]);
    });
  });

  describe("signing out", () => {
    it("signs out through the library, holds no person, and goes to the entry route", async () => {
      await onProfile();

      await currentUser().signOut();

      expect(sentTo("sign-out")).toHaveLength(1);
      expect(currentUser().person()).toBeNull();
      expect(url()).toBe("/");
    });

    it("stays where it is, still signed in, when the library refuses", async () => {
      await onProfile();
      failing("sign-out", 500);

      await currentUser().signOut();

      expect(currentUser().person()).not.toBeNull();
      expect(url()).toBe("/profile");
    });
  });

  describe("deleting the account (US5)", () => {
    it("opens the deletion for the person the library answers for now, nothing running", async () => {
      await onProfile(["google"]);
      signedInAs({ ...stefan, providers: ["google", "microsoft"] });

      await currentUser().openDeletion();

      expect(currentUser().deletion()).toEqual({ working: false, failed: false });
      expect(currentUser().person()?.providers).toEqual(["google", "microsoft"]);
      expect(sentTo("delete-user")).toHaveLength(0);
    });

    it("goes to the entry route, and opens nothing, when there is no session any more", async () => {
      await onProfile();
      signedOut();

      await currentUser().openDeletion();

      expect(currentUser().deletion()).toBeNull();
      expect(url()).toBe("/");
    });

    it("goes to the entry route, and opens nothing, when the library cannot be reached", async () => {
      await onProfile();
      unreachable();

      await currentUser().openDeletion();

      expect(currentUser().deletion()).toBeNull();
      expect(url()).toBe("/");
    });

    it("closes the deletion, and sends nothing", async () => {
      await onProfile();
      await currentUser().openDeletion();

      currentUser().closeDeletion();

      expect(currentUser().deletion()).toBeNull();
      expect(sentTo("delete-user")).toHaveLength(0);
    });

    it("deletes through the library once, closes the deletion, and goes to /?deleted", async () => {
      await onProfile();
      await currentUser().openDeletion();

      await currentUser().deleteAccount();

      expect(sentTo("delete-user")).toHaveLength(1);
      expect(sentTo("delete-user")[0]?.method).toBe("POST");
      expect(currentUser().deletion()).toBeNull();
      // The router writes an empty query value out as `deleted=`; the entry route reads
      // whether the address has `deleted` (F8).
      expect(url()).toBe("/?deleted=");
    });

    it("keeps the deletion open and failed, nothing running, on /profile, when the library refuses", async () => {
      await onProfile();
      failing("delete-user", 500);
      await currentUser().openDeletion();

      await currentUser().deleteAccount();

      expect(currentUser().deletion()).toEqual({ working: false, failed: true });
      expect(currentUser().person()).not.toBeNull();
      expect(url()).toBe("/profile");
    });

    it("keeps the deletion open and failed when the library cannot be reached", async () => {
      await onProfile();
      await currentUser().openDeletion();
      unreachable();

      await currentUser().deleteAccount();

      expect(currentUser().deletion()).toEqual({ working: false, failed: true });
      expect(url()).toBe("/profile");
    });
  });
});
