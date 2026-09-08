import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * The empty state: the answer that no run exists is an answer, and this is what it
 * looks like. It is a component and not a paragraph in the page so that the page's
 * template says the name of the thing it renders when there is nothing to show.
 */
@Component({
  selector: "no-run-yet",
  host: {
    class:
      "flex flex-col items-center gap-2 rounded-lg border border-border border-dashed bg-card px-6 py-8 text-center",
  },
  template: `
    <p class="text-ui font-semibold">No run yet</p>
    <p class="max-w-sm text-caption text-muted-foreground">
      Start one and its units appear here, in the order they run.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoRunYet {}
