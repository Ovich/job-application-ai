import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfirmAction } from "../../../../src/app/ui/confirm-action/confirm-action";

/**
 * The confirm gate (ID89), rendered inside a host that fills its inputs and its body,
 * the way the shell does (seam C). Nothing crosses the network: the inputs come in, and
 * what the person chooses leaves as `confirm` or `cancel`.
 *
 * With a code it is the destructive gate: eight characters from A to Z and 2 to 9
 * without O, 0, I and 1, new each time it is created, and the action red and disarmed
 * until they are typed. The assertions read the code off the screen and type it into
 * the field, as a person does; they never reach into the component's fields and never
 * replace its random source.
 */

/** The alphabet the code is drawn from, as a pattern for the whole of one code. */
const aCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

@Component({
  imports: [AppConfirmAction],
  template: `<app-confirm-action
    title="Delete your account?"
    confirmLabel="Delete account"
    [code]="code()"
    [working]="working()"
    workingLabel="Deleting everything…"
    (confirm)="confirmed()"
    (cancel)="cancelled()"
    ><p>Everything in it goes.</p></app-confirm-action
  >`,
})
class Host {
  public readonly code = signal(true);

  public readonly working = signal(false);

  public readonly confirmed = vi.fn();

  public readonly cancelled = vi.fn();
}

describe("app-confirm-action", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** The gate in its host, attached to the document so a press outside has somewhere to land. */
  const gate = (options: { code?: boolean } = {}) => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.code.set(options.code ?? true);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const panel = (): HTMLElement | null => element.querySelector("[role=dialog]");
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(element.querySelectorAll("button")).find((each) => textOf(each) === label);
    const field = (): HTMLInputElement | null => element.querySelector("input");
    /** The code as it reads on the screen: the one element whose whole text is a code. */
    const shownCode = (): string | undefined =>
      Array.from(element.querySelectorAll("*"))
        .map(textOf)
        .find((text) => /^[A-Z0-9]{8}$/.test(text));
    const type = (text: string) => {
      const input = field();
      if (input === null) {
        throw new Error("no field to type in");
      }
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.detectChanges();
    };
    const press = (label: string) => {
      button(label)?.click();
      fixture.detectChanges();
    };
    const setWorking = (working: boolean) => {
      host.working.set(working);
      fixture.detectChanges();
    };
    return { fixture, host, element, panel, button, field, shownCode, type, press, setWorking };
  };

  it("shows the title, the body, the phrase, a code of eight, the empty field, and the action red and disabled", () => {
    const g = gate();

    expect(g.panel()).not.toBeNull();
    expect(textOf(g.panel())).toContain("Delete your account?");
    expect(textOf(g.panel())).toContain("Everything in it goes.");
    expect(textOf(g.panel())).toContain("Type this code to confirm:");
    expect(g.shownCode()).toMatch(aCode);
    expect(g.field()?.value).toBe("");
    expect(g.button("Cancel")?.disabled).toBe(false);
    expect(g.button("Delete account")?.disabled).toBe(true);
    expect(g.button("Delete account")?.classList.contains("bg-danger")).toBe(true);
  });

  it("names its panel a dialog, labelled by its title, and gives the field the focus", async () => {
    const g = gate();
    await g.fixture.whenStable();

    const labelledBy = g.panel()?.getAttribute("aria-labelledby") ?? "";
    expect(textOf(document.getElementById(labelledBy))).toBe("Delete your account?");
    expect(document.activeElement).toBe(g.field());
    expect(g.field()?.getAttribute("aria-label")).toBe(`Type ${g.shownCode()} to confirm`);
  });

  it("stays disabled when what is typed is not the code", () => {
    const g = gate();

    g.type("NOTTHECODE");

    expect(g.button("Delete account")?.disabled).toBe(true);
  });

  it("arms when the code is typed in lower case and with spaces", () => {
    const g = gate();
    const code = g.shownCode() ?? "";

    g.type(` ${code.slice(0, 4).toLowerCase()} ${code.slice(4).toLowerCase()} `);

    expect(g.button("Delete account")?.disabled).toBe(false);
  });

  it("shows a new code each time it is created", () => {
    const first = gate().shownCode();
    const second = gate().shownCode();

    expect(first).toMatch(aCode);
    expect(second).toMatch(aCode);
    expect(second).not.toBe(first);
  });

  it("emits cancel once on Cancel", () => {
    const g = gate();

    g.press("Cancel");

    expect(g.host.cancelled).toHaveBeenCalledTimes(1);
    expect(g.host.confirmed).not.toHaveBeenCalled();
  });

  it("emits cancel once on Escape", () => {
    const g = gate();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(g.host.cancelled).toHaveBeenCalledTimes(1);
  });

  it("emits cancel once on a press outside it, and nothing on a press inside", () => {
    const g = gate();

    g.panel()?.click();
    expect(g.host.cancelled).not.toHaveBeenCalled();
    document.body.click();

    expect(g.host.cancelled).toHaveBeenCalledTimes(1);
  });

  it("emits confirm once when the armed action is pressed", () => {
    const g = gate();
    g.type(g.shownCode() ?? "");

    g.press("Delete account");

    expect(g.host.confirmed).toHaveBeenCalledTimes(1);
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("while working shows the working line in place of the code, the field and the buttons, and Escape and a press outside emit nothing", () => {
    const g = gate();
    g.type(g.shownCode() ?? "");
    g.press("Delete account");

    g.setWorking(true);

    expect(textOf(g.panel())).toContain("Deleting everything…");
    expect(textOf(g.panel())).toContain("Delete your account?");
    expect(textOf(g.panel())).toContain("Everything in it goes.");
    expect(g.shownCode()).toBeUndefined();
    expect(g.field()).toBeNull();
    expect(g.element.querySelectorAll("button")).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("when the work ends, keeps the same code, what was typed, and the action armed", () => {
    const g = gate();
    const code = g.shownCode() ?? "";
    g.type(code.toLowerCase());
    g.press("Delete account");
    g.setWorking(true);

    g.setWorking(false);

    expect(g.shownCode()).toBe(code);
    expect(g.field()?.value).toBe(code.toLowerCase());
    expect(g.button("Delete account")?.disabled).toBe(false);
  });

  it("without a code is the plain confirm: no phrase, no field, the action primary and live", () => {
    const g = gate({ code: false });

    expect(textOf(g.panel())).not.toContain("Type this code to confirm:");
    expect(g.shownCode()).toBeUndefined();
    expect(g.field()).toBeNull();
    expect(g.button("Delete account")?.disabled).toBe(false);
    expect(g.button("Delete account")?.classList.contains("bg-primary")).toBe(true);
    g.press("Delete account");
    expect(g.host.confirmed).toHaveBeenCalledTimes(1);
  });
});
