import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { LeafLine } from "./leaf-line";

/**
 * A run of characters the stream just produced. It is the value itself and not a
 * report about the value, so the line carries the text and nothing else: no mark, no
 * label, nothing between the person and what arrived.
 *
 * Its whitespace is kept, the server sending the line breaks it means.
 */
@Component({
  selector: "li[textLeaf]",
  imports: [LeafLine],
  template: `
    <leaf-line>
      <span class="min-w-0 flex-1 whitespace-pre-wrap">{{ text() }}</span>
    </leaf-line>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextLeaf {
  readonly text = input.required<string>();
}
