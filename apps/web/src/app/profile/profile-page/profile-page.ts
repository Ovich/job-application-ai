import { Component } from "@angular/core";
import { ProfileViewer } from "../profile-viewer/profile-viewer";

/**
 * The profile page (D2, D19, `ID331`): the route, and one column.
 *
 * **Nothing asks here any more** (product-flow-rework `S2.1`, `H13`). The page used to be
 * the CV builder's two-column workbench — the assistant on the left, the document on the
 * right — and to hold nine signals relaying between them. The assistant leaves the intake,
 * so the relays have nobody to relay to and the grid has nothing to put in its second
 * column: what is left is the viewer, which owns the bar, the sheet and the way back to
 * the documents.
 *
 * It holds no behaviour of its own, as it never did.
 */
@Component({
  selector: "profile-page",
  imports: [ProfileViewer],
  templateUrl: "./profile-page.html",
  // The layout every full page holds to (the person, 2026-09-12): this fills the page
  // rather than growing past it, so the window never scrolls and the sheet's column
  // decides for itself what moves inside it.
  host: { class: "flex min-h-0 flex-1 flex-col" },
})
export class ProfilePage {}
