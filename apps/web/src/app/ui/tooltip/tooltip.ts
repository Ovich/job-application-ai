import {
  Directive,
  ElementRef,
  inject,
  input,
  type OnDestroy,
  Renderer2,
  signal,
} from "@angular/core";

/** Each tooltip its own id, so the element it describes can point at it. */
let opened = 0;

/** The gap between the host and the panel, and the margin it keeps from the viewport. */
const gap = 8;

/**
 * A tooltip on anything (ID161): `[uiTooltip]="the sentence"`.
 *
 * A directive rather than a wrapper, so it attaches to the element that already exists
 * — a chip, a button, a truncated title — instead of asking a caller to re-nest their
 * markup around it.
 *
 * **The panel is attached to `document.body`**, not beside its host. Every place worth
 * putting a tooltip is inside something that clips: the assistant's column, the dock,
 * the sheet's scroller. A panel drawn in the flow would be cut off by exactly the
 * containers that make the layout work.
 *
 * It opens on hover and on focus, and closes on leave, on blur and on Escape — because
 * a tooltip a keyboard cannot reach is decoration, and one a keyboard cannot dismiss is
 * a trap. The host is described by it while it is open (`aria-describedby`), and the
 * panel is `role="tooltip"`, so it is read as what it is rather than as more content.
 *
 * What it never does is hold anything a person needs. A tooltip is the second telling;
 * anything that must be read belongs on the screen.
 */
@Directive({
  selector: "[uiTooltip]",
  host: {
    "(mouseenter)": "show()",
    "(focusin)": "show()",
    "(mouseleave)": "hide()",
    "(focusout)": "hide()",
    "(document:keydown.escape)": "hide()",
    "[attr.aria-describedby]": "shown() ? id : null",
  },
})
export class UiTooltip implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);

  /** What the tooltip says. Nothing is shown when it is empty. */
  public readonly text = input.required<string>({ alias: "uiTooltip" });

  protected readonly id = `tooltip-${++opened}`;

  protected readonly shown = signal(false);

  private panel: HTMLElement | null = null;

  public ngOnDestroy(): void {
    this.hide();
  }

  protected show(): void {
    const said = this.text().trim();
    if (said === "" || this.panel !== null) return;

    const panel = this.renderer.createElement("div") as HTMLElement;
    panel.id = this.id;
    panel.setAttribute("role", "tooltip");
    panel.textContent = said;
    panel.className =
      "pointer-events-none fixed z-[60] max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-background text-caption shadow-card";
    this.renderer.appendChild(document.body, panel);
    this.panel = panel;
    this.shown.set(true);
    this.place(panel);
  }

  protected hide(): void {
    if (this.panel !== null) this.renderer.removeChild(document.body, this.panel);
    this.panel = null;
    this.shown.set(false);
  }

  /** Above the host, centred on it, and inside the viewport whatever that costs. */
  private place(panel: HTMLElement): void {
    const anchor = (this.host.nativeElement as HTMLElement).getBoundingClientRect();
    const box = panel.getBoundingClientRect();

    const above = anchor.top - box.height - gap;
    const top = above >= gap ? above : anchor.bottom + gap;

    const centred = anchor.left + anchor.width / 2 - box.width / 2;
    const left = Math.min(Math.max(centred, gap), window.innerWidth - box.width - gap);

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }
}
