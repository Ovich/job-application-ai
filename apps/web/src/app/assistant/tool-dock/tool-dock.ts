import { Component } from "@angular/core";

/**
 * The dock a tool sits in, above the composer. **Abstract**: it holds whatever tool is
 * projected into it and knows nothing about which one — the intake's interview today,
 * the CV builder's and the cover builder's tomorrow. What is open, and when it closes,
 * is the assistant's business and never this component's.
 *
 * **The dock closes only when nothing is left to ask** (the mockup's handoff note):
 * while a question waits the tool stays open and the prefix's × skips to the next one.
 */
@Component({
  selector: "tool-dock",
  templateUrl: "./tool-dock.html",
  host: {
    class: "mb-2.5 block min-w-0 max-h-[45dvh] min-h-0 shrink overflow-y-auto overflow-x-hidden",
  },
})
export class ToolDock {}
