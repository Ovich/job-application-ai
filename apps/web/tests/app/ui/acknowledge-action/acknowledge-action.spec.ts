import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppAcknowledgeAction } from "../../../../src/app/ui/acknowledge-action/acknowledge-action";

/**
 * The acknowledge gate (ID99, amending ID89 and ID95), rendered inside a host that fills
 * its inputs and its body (seam C). A panel with a title, the caller's body, Cancel and
 * one action whose label, colour and disabled state are the caller's; nothing of any one
 * action's business, no code. Nothing crosses the network: the inputs come in, and what
 * the person chooses leaves as `action` or `cancel`.
 */

const textOf = (element: Element | null | undefined): string =>
  (element?.textContent ?? "").replace(/\s+/g, " ").trim();

@Component({
  imports: [AppAcknowledgeAction],
  template: `<app-acknowledge-action
    title="Leave the draft?"
    [actionLabel]="actionLabel()"
    [destructive]="destructive()"
    [disabled]="disabled()"
    [working]="working()"
    workingLabel="Leaving…"
    (action)="acted()"
    (cancel)="cancelled()"
    ><p>What you wrote stays where it is.</p></app-acknowledge-action
  >`,
})
class Host {
  public readonly actionLabel = signal("Leave");

  public readonly destructive = signal(false);

  public readonly disabled = signal(false);

  public readonly working = signal(false);

  public readonly acted = vi.fn();

  public readonly cancelled = vi.fn();
}

describe("app-acknowledge-action", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** The gate in its host, attached to the document so a press outside has somewhere to land. */
  const gate = (set: (host: Host) => void = () => undefined) => {
    const fixture = TestBed.createComponent(Host);
    set(fixture.componentInstance);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const panel = (): HTMLElement | null => element.querySelector("[role=dialog]");
    const buttons = () => Array.from(element.querySelectorAll("button"));
    const button = (label: string): HTMLButtonElement => {
      const found = buttons().find((each) => textOf(each) === label);
      if (found === undefined) {
        throw new Error(`no button reads "${label}"`);
      }
      return found;
    };
    const press = (label: string) => {
      button(label).click();
      fixture.detectChanges();
    };
    const update = (change: (host: Host) => void) => {
      change(host);
      fixture.detectChanges();
    };
    return { fixture, host, element, panel, buttons, button, press, update };
  };

  it("shows the title, the body, Cancel and the action, primary and live", () => {
    const g = gate();

    expect(textOf(g.panel())).toContain("Leave the draft?");
    expect(textOf(g.panel())).toContain("What you wrote stays where it is.");
    expect(g.buttons().map(textOf)).toEqual(["Cancel", "Leave"]);
    expect(g.button("Leave").classList.contains("bg-primary")).toBe(true);
    expect(g.button("Leave").disabled).toBe(false);
  });

  it("names its panel a dialog, labelled by its title, and gives the action the focus", async () => {
    const g = gate();
    await g.fixture.whenStable();

    const labelledBy = g.panel()?.getAttribute("aria-labelledby") ?? "";
    expect(textOf(document.getElementById(labelledBy))).toBe("Leave the draft?");
    expect(document.activeElement).toBe(g.button("Leave"));
  });

  it("draws the action red when it is destructive, and relabels it when told", () => {
    const g = gate((host) => {
      host.destructive.set(true);
      host.actionLabel.set("Delete account");
    });

    expect(g.button("Delete account").classList.contains("bg-danger")).toBe(true);
  });

  it("emits action once when the action is pressed", () => {
    const g = gate();

    g.press("Leave");

    expect(g.host.acted).toHaveBeenCalledTimes(1);
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("emits nothing from a disabled action", () => {
    const g = gate((host) => host.disabled.set(true));

    expect(g.button("Leave").disabled).toBe(true);
    g.press("Leave");

    expect(g.host.acted).not.toHaveBeenCalled();
  });

  it("emits cancel once on Cancel", () => {
    const g = gate();

    g.press("Cancel");

    expect(g.host.cancelled).toHaveBeenCalledTimes(1);
    expect(g.host.acted).not.toHaveBeenCalled();
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

  it("while working shows the working line and a spinner in place of the buttons, the body kept, and Escape and a press outside emit nothing", () => {
    const g = gate();

    g.update((host) => host.working.set(true));

    expect(textOf(g.panel())).toContain("Leaving…");
    expect(textOf(g.panel())).toContain("Leave the draft?");
    expect(textOf(g.panel())).toContain("What you wrote stays where it is.");
    expect(g.panel()?.querySelector("[uiSpinner]")).not.toBeNull();
    expect(g.buttons()).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.click();
    expect(g.host.cancelled).not.toHaveBeenCalled();
  });

  it("when the work ends, gives the buttons back", () => {
    const g = gate();
    g.update((host) => host.working.set(true));

    g.update((host) => host.working.set(false));

    expect(g.buttons().map(textOf)).toEqual(["Cancel", "Leave"]);
  });
});
