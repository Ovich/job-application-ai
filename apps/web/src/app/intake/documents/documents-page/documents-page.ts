import { Component, effect, inject } from "@angular/core";
import { Router } from "@angular/router";
import { Documents } from "../documents";
import { DocumentsDropZone } from "../documents-drop-zone/documents-drop-zone";

/**
 * The documents page (`ID124`, spec D15): the `/documents` route, the first thing a person
 * does after signing in. It provides `Documents` and renders the drop zone under it.
 *
 * The reading's landing opens the profile, a second after the green line
 * (`Documents.readDone`): the thing a person came here to make.
 */
@Component({
  selector: "documents-page",
  imports: [DocumentsDropZone],
  templateUrl: "./documents-page.html",
  providers: [Documents],
})
export class DocumentsPage {
  private readonly documents = inject(Documents);

  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.documents.readDone() > 0) void this.router.navigateByUrl("/profile");
    });
  }
}
