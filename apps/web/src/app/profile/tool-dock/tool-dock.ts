import { Component } from "@angular/core";

/**
 * The dock a tool sits in, above the composer (the builder's own, same name and same
 * chrome). It holds the tool and nothing else: what is open, and when it closes, is the
 * assistant's business.
 *
 * **The dock closes only when nothing is left to ask** (the mockup's handoff note):
 * while a question waits the tool stays open and the prefix's × skips to the next one.
 */
@Component({
  selector: "tool-dock",
  template: "<ng-content />",
  host: { class: "mb-2.5 block max-h-[56vh] overflow-auto" },
})
export class ToolDock {}
