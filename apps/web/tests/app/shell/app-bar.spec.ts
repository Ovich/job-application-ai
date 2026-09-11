import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../../../src/app/auth/session";
import { AppBar } from "../../../src/app/shell/app-bar/app-bar";

/**
 * The AppBar, rendered (seam B): the initials in the account slot, and the menu that
 * opens from it with the name, the address, the providers linked to the account, Sign
 * out and Delete my account (US3, S3.2, F1).
 *
 * Nothing crosses the network: the user comes in as an input and what the person does
 * leaves as outputs. What is asserted is the bar's rendered text and its outputs, the
 * way a person reads and presses, never its fields or its template's structure. What
 * follows a sign-out is the shell's (seam E).
 */

const stefan: { name: string; email: string; providers: Provider[] } = {
  name: "Stefan Teofanovic",
  email: "stefan.teofanovic@example.com",
  providers: ["google"],
};

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the AppBar", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AppBar], providers: [provideRouter([])] });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** The bar drawn for `user`, attached to the document so a press outside has somewhere to land. */
  const barFor = (user: typeof stefan) => {
    const fixture = TestBed.createComponent(AppBar);
    fixture.componentRef.setInput("user", user);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const slot = (): HTMLButtonElement => {
      const button = element.querySelector<HTMLButtonElement>('button[aria-label="Your account"]');
      if (button === null) {
        throw new Error("no account slot");
      }
      return button;
    };
    const menu = (): HTMLElement | null => element.querySelector("[role=menu]");
    const menuItem = (label: string): HTMLButtonElement => {
      const item = Array.from(menu()?.querySelectorAll("button") ?? []).find(
        (button) => textOf(button) === label,
      );
      if (item === undefined) {
        throw new Error(`no menu item reads "${label}"`);
      }
      return item;
    };
    const open = () => {
      slot().click();
      fixture.detectChanges();
    };
    return { fixture, element, slot, menu, menuItem, open };
  };

  it("shows the initials in the account slot, the menu closed", () => {
    const bar = barFor(stefan);

    expect(textOf(bar.slot())).toBe("ST");
    expect(bar.slot().getAttribute("aria-expanded")).toBe("false");
    expect(bar.menu()).toBeNull();
  });

  it("opens the menu with the name, the address and the provider signed in with", () => {
    const bar = barFor(stefan);

    bar.open();

    expect(bar.slot().getAttribute("aria-expanded")).toBe("true");
    expect(textOf(bar.menu())).toContain("Stefan Teofanovic");
    expect(textOf(bar.menu())).toContain("stefan.teofanovic@example.com");
    expect(textOf(bar.menu())).toContain("Signed in with Google");
    expect(Array.from(bar.menu()?.querySelectorAll("button") ?? []).map(textOf)).toEqual([
      "Sign out",
      "Delete my account",
    ]);
  });

  it("names two linked providers in the order given", () => {
    const bar = barFor({ ...stefan, providers: ["linkedin", "google"] });

    bar.open();

    const text = textOf(bar.menu());
    expect(text).toContain("LinkedIn");
    expect(text).toContain("Google");
    expect(text.indexOf("LinkedIn")).toBeLessThan(text.indexOf("Google"));
  });

  it("emits signOut once when Sign out is pressed, and closes the menu", () => {
    const bar = barFor(stefan);
    const signOut = vi.fn();
    bar.fixture.componentInstance.signOut.subscribe(signOut);
    bar.open();

    bar.menuItem("Sign out").click();
    bar.fixture.detectChanges();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(bar.menu()).toBeNull();
  });

  it("emits deleteAccount once when Delete my account is pressed, and closes the menu", () => {
    const bar = barFor(stefan);
    const deleteAccount = vi.fn();
    bar.fixture.componentInstance.deleteAccount.subscribe(deleteAccount);
    bar.open();

    bar.menuItem("Delete my account").click();
    bar.fixture.detectChanges();

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(bar.menu()).toBeNull();
  });

  it("closes the menu on Escape", () => {
    const bar = barFor(stefan);
    bar.open();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    bar.fixture.detectChanges();

    expect(bar.menu()).toBeNull();
    expect(bar.slot().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the menu on a press outside it", () => {
    const bar = barFor(stefan);
    bar.open();

    document.body.click();
    bar.fixture.detectChanges();

    expect(bar.menu()).toBeNull();
  });

  it("keeps the menu open on a press inside it", () => {
    const bar = barFor(stefan);
    bar.open();

    bar.menu()?.click();
    bar.fixture.detectChanges();

    expect(bar.menu()).not.toBeNull();
  });
});
