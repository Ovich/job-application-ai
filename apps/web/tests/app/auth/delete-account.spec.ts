import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDeleteAccount } from "../../../src/app/auth/delete-account/delete-account";
import type { Provider } from "../../../src/app/auth/session";

/**
 * Deleting the account, the gate's business (ID99, ID95, US5), rendered inside a host
 * that fills its inputs (seam C). Two steps over the acknowledge gate: the warning, what
 * goes and what it costs, with Cancel and Acknowledge; then, acknowledged, eight
 * characters from A to Z and 2 to 9 without O, 0, I and 1, drawn at that press, and a
 * red Delete account disarmed until they are typed, in any case and with any spaces.
 *
 * Nothing crosses the network: the providers, whether the deletion is running and
 * whether it failed come in, and the person's choice leaves as `confirm` or `cancel`.
 * The assertions read the code off the screen and type it into the field, as a person
 * does; they never reach into the component's fields and never replace its random source.
 */

/** The alphabet the code is drawn from, as a pattern for the whole of one code. */
const aCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

@Component({
  imports: [AppDeleteAccount],
  template: `<app-delete-account
    [providers]="providers()"
    [working]="working()"
    [failed]="failed()"
    (confirm)="confirmed()"
    (cancel)="cancelled()"
  />`,
})
class Host {
  public readonly providers = signal<Provider[]>(["linkedin", "microsoft"]);

  public readonly working = signal(false);

  public readonly failed = signal(false);

  public readonly confirmed = vi.fn();

  public readonly cancelled = vi.fn();
}

describe("app-delete-account", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** The gate in its host, attached to the document so a press outside has somewhere to land. */
  const gate = () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const panel = (): HTMLElement | null => element.querySelector("[role=dialog]");
    const buttons = () => Array.from(element.querySelectorAll("button"));
    const button = (label: string): HTMLButtonElement | undefined =>
      buttons().find((each) => textOf(each) === label);
    const field = (): HTMLInputElement | null => element.querySelector("input");
    /** The code as it reads on the screen: the one element whose whole text is a code. */
    const shownCode = (): string | undefined =>
      Array.from(element.querySelectorAll("*"))
        .map(textOf)
        .find((text) => /^[A-Z0-9]{8}$/.test(text));
    const press = (label: string) => {
      const pressed = button(label);
      if (pressed === undefined) {
        throw new Error(`no button reads "${label}"`);
      }
      pressed.click();
      fixture.detectChanges();
    };
    const type = (text: string) => {
      const input = field();
      if (input === null) {
        throw new Error("no field to type in");
      }
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.detectChanges();
    };
    const update = (change: (host: Host) => void) => {
      change(host);
      fixture.detectChanges();
    };
    return {
      fixture,
      host,
      element,
      panel,
      buttons,
      button,
      field,
      shownCode,
      press,
      type,
      update,
    };
  };

  /** Past the warning: created, then Acknowledge pressed. */
  const acknowledged = () => {
    const g = gate();
    g.press("Acknowledge");
    return g;
  };

  it("first shows the warning alone: the title, the message, a line per provider in order, the money callout, Cancel and Acknowledge", () => {
    const g = gate();

    const text = textOf(g.panel());
    expect(text).toContain("Delete your account?");
    expect(text).toContain(
      "This permanently deletes your account and everything in it. It cannot be undone, and nothing can be recovered, by you or by us.",
    );
    expect(Array.from(g.panel()?.querySelectorAll("li") ?? []).map(textOf)).toEqual([
      "Your sign-in with LinkedIn goes. Your LinkedIn account itself is not touched.",
      "Your sign-in with Microsoft goes. Your Microsoft account itself is not touched.",
    ]);
    expect(textOf(g.panel()?.querySelector("app-notice[role=note]"))).toBe(
      "Your membership is cancelled. Credits you have left are not refunded.",
    );
    expect(text).not.toContain("Type this code to confirm:");
    expect(g.shownCode()).toBeUndefined();
    expect(g.field()).toBeNull();
    expect(g.buttons().map(textOf)).toEqual(["Cancel", "Acknowledge"]);
    expect(g.button("Acknowledge")?.classList.contains("bg-primary")).toBe(true);
  });

  it("emits cancel once on Cancel at the warning, and never confirm", () => {
    const g = gate();

    g.press("Cancel");

    expect(g.host.cancelled).toHaveBeenCalledTimes(1);
    expect(g.host.confirmed).not.toHaveBeenCalled();
  });

  it("on Acknowledge keeps the warning and reveals the phrase, a code of eight, the empty field, and Delete account red and disabled", () => {
    const g = acknowledged();

    const text = textOf(g.panel());
    expect(text).toContain("Your membership is cancelled.");
    expect(text).toContain("Type this code to confirm:");
    expect(g.shownCode()).toMatch(aCode);
    expect(g.field()?.value).toBe("");
    expect(g.field()?.getAttribute("aria-label")).toBe(`Type ${g.shownCode()} to confirm`);
    expect(g.field()?.getAttribute("autocomplete")).toBe("off");
    expect(g.button("Acknowledge")).toBeUndefined();
    expect(g.button("Delete account")?.disabled).toBe(true);
    expect(g.button("Delete account")?.classList.contains("bg-danger")).toBe(true);
    expect(g.host.confirmed).not.toHaveBeenCalled();
  });

  it("gives the field the focus once acknowledged", async () => {
    const g = acknowledged();
    await g.fixture.whenStable();

    expect(document.activeElement).toBe(g.field());
  });

  it("shows a new code at each acknowledgement", () => {
    const first = acknowledged().shownCode();
    const second = acknowledged().shownCode();

    expect(first).toMatch(aCode);
    expect(second).toMatch(aCode);
    expect(second).not.toBe(first);
  });

  it("stays disabled when what is typed is not the code", () => {
    const g = acknowledged();

    g.type("NOTTHECODE");

    expect(g.button("Delete account")?.disabled).toBe(true);
  });

  it("arms when the code is typed in lower case and with spaces, and confirms once", () => {
    const g = acknowledged();
    const code = g.shownCode() ?? "";

    g.type(` ${code.slice(0, 4).toLowerCase()} ${code.slice(4).toLowerCase()} `);
    expect(g.button("Delete account")?.disabled).toBe(false);
    g.press("Delete account");

    expect(g.host.confirmed).toHaveBeenCalledTimes(1);
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("emits cancel once on Cancel, Escape or a press outside, beside the code", () => {
    const cancelled = acknowledged();
    cancelled.press("Cancel");
    expect(cancelled.host.cancelled).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";

    const escaped = acknowledged();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escaped.host.cancelled).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";

    const outside = acknowledged();
    document.body.click();
    expect(outside.host.cancelled).toHaveBeenCalledTimes(1);
  });

  it("while working shows the working line in place of the code, the field and the buttons, the warning kept", () => {
    const g = acknowledged();
    g.type(g.shownCode() ?? "");
    g.press("Delete account");

    g.update((host) => host.working.set(true));

    const text = textOf(g.panel());
    expect(text).toContain("Deleting everything…");
    expect(text).toContain("Delete your account?");
    expect(text).toContain("Your membership is cancelled.");
    expect(text).not.toContain("Type this code to confirm:");
    expect(g.shownCode()).toBeUndefined();
    expect(g.field()).toBeNull();
    expect(g.buttons()).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("when the work ends in a failure, says nothing was deleted and keeps the same code, what was typed, and the action armed", () => {
    const g = acknowledged();
    const code = g.shownCode() ?? "";
    g.type(code.toLowerCase());
    g.press("Delete account");
    g.update((host) => host.working.set(true));

    g.update((host) => {
      host.working.set(false);
      host.failed.set(true);
    });

    expect(textOf(g.panel()?.querySelector("app-notice[role=alert]"))).toBe(
      "Nothing was deleted. The deletion did not go through. Try again in a moment.",
    );
    expect(g.shownCode()).toBe(code);
    expect(g.field()?.value).toBe(code.toLowerCase());
    expect(g.button("Delete account")?.disabled).toBe(false);
  });
});
