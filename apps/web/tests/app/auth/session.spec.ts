import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routes } from "../../../src/app/app.routes";
import { session } from "../../../src/app/auth/session";
import { reset, sentTo, signedInAs, signedOut, unreachable } from "../../support/session";

/**
 * Who is signed in (ID74), read through the library's client and never from the
 * cookie: the session cookie is HttpOnly, and "signed in" is only ever what the
 * library's `get-session` answers at that moment. Seam C of the slice.
 *
 * `session()` is asked as a function; the two guards are never called as functions
 * but reached through the router with the application's own routes (ID73), so what
 * is proved is where a browser lands, which is the only thing a person sees of a
 * guard. The library is stood in for at the network by `tests/support/session`.
 */

const stefan = { name: "Stefan Teofanovic", email: "stefan@example.com" };

describe("the session", () => {
  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    reset();
  });

  it("answers null when the library has no session", async () => {
    signedOut();

    await expect(session()).resolves.toBeNull();
  });

  it("answers the name, the address and the linked provider", async () => {
    signedInAs({ ...stefan, providers: ["google"] });

    await expect(session()).resolves.toEqual({ ...stefan, providers: ["google"] });
  });

  it("lists two linked providers in the order they were linked, oldest first", async () => {
    signedInAs({ ...stefan, providers: ["linkedin", "google"] });

    await expect(session()).resolves.toEqual({ ...stefan, providers: ["linkedin", "google"] });
  });

  it("answers what the library answers now, so a sign-out is seen by the next call", async () => {
    signedInAs({ ...stefan, providers: ["google"] });
    await expect(session()).resolves.not.toBeNull();

    signedOut();

    await expect(session()).resolves.toBeNull();
  });

  it("asks the library nothing but who am I and which accounts", async () => {
    signedInAs({ ...stefan, providers: ["google"] });

    await session();

    expect(sentTo("get-session")).toHaveLength(1);
    expect(sentTo("list-accounts")).toHaveLength(1);
  });
});

describe("the guards, through the router", () => {
  beforeEach(() => {
    reset();
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  afterEach(() => {
    reset();
  });

  /** Where the browser is after opening `url`: one harness per test, as the router asks. */
  const landingAfter = async (...urls: string[]): Promise<string[]> => {
    const harness = await RouterTestingHarness.create();
    const landed: string[] = [];
    for (const url of urls) {
      await harness.navigateByUrl(url);
      landed.push(TestBed.inject(Router).url);
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

  it("lets a signed-in browser see /profile", async () => {
    signedInAs({ ...stefan, providers: ["google"] });

    expect(await landingAfter("/profile")).toEqual(["/profile"]);
  });

  it("treats a library that cannot be reached as no session, on both routes", async () => {
    unreachable();

    expect(await landingAfter("/profile", "/")).toEqual(["/", "/"]);
  });
});
