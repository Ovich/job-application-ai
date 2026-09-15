import { Component, output } from "@angular/core";
import { UiModal } from "../../../ui/modal/modal";
import { DocumentsDropZone } from "../documents-drop-zone/documents-drop-zone";

/**
 * The drop zone over the profile (`ID160`, spec D15): a `UiModal` around
 * `DocumentsDropZone`, told it is somebody else's content, so it says nothing about
 * opening a profile a person is already looking at. It draws from the `Documents` its
 * holder provides; opening and closing it are the holder's.
 */
@Component({
  selector: "add-documents-modal",
  imports: [DocumentsDropZone, UiModal],
  templateUrl: "./add-documents-modal.html",
})
export class AddDocumentsModal {
  /** The person left the modal: the close button, Escape or a press outside the panel. */
  public readonly closed = output<void>();

  /** The drop zone's Done, once every document is read. */
  public readonly done = output<void>();
}
