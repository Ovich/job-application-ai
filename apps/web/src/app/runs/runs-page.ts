import { ChangeDetectionStrategy, Component, resource } from "@angular/core";
import { api } from "../lib/api";
import { DoneUnit } from "./done-unit";
import { FailedUnit } from "./failed-unit";
import { NoRunYet } from "./no-run-yet";
import { PendingUnit } from "./pending-unit";
import { RunSummary } from "./run-summary";

/**
 * The latest run and its units (US3, US6): the first screen there is, and the one that
 * proves the chain from the database to the browser end to end.
 *
 * The run is read through the RPC client inside a `resource` loader (rule 14), so the
 * shape rendered here is the one the API sends, inferred, with nothing declared in
 * between (rule 4). A state is a component, never a class string chosen by an `if`:
 * the page names what it renders and the leaf holds the utilities (rule 16).
 */
@Component({
  selector: "app-runs-page",
  imports: [DoneUnit, FailedUnit, NoRunYet, PendingUnit, RunSummary],
  host: { class: "block" },
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-col gap-1">
        <h1 class="text-figure font-semibold">Latest run</h1>
        @if (latest.value(); as run) {
          <run-summary
            [kind]="run.kind"
            [createdAt]="run.createdAt"
            [finishedAt]="run.finishedAt"
          />
        }
      </header>

      @if (latest.isLoading()) {
        <p class="text-caption text-muted-foreground">Reading the latest run&hellip;</p>
      } @else if (latest.error()) {
        <p class="text-caption text-danger">The latest run could not be read.</p>
      } @else if (latest.value(); as run) {
        <ul
          class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card"
        >
          @for (unit of run.units; track unit.seq) {
            @switch (unit.status) {
              @case ("done") {
                <li doneUnit [seq]="unit.seq" [result]="unit.result" [doneAt]="unit.doneAt"></li>
              }
              @case ("failed") {
                <li failedUnit [seq]="unit.seq" [result]="unit.result" [doneAt]="unit.doneAt"></li>
              }
              @case ("pending") {
                <li pendingUnit [seq]="unit.seq"></li>
              }
            }
          }
        </ul>
      } @else {
        <no-run-yet />
      }
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunsPage {
  /**
   * The latest run, or `null` when the API says there is none. A 404 is an answer and
   * not a failure: it is what the empty state renders, so it resolves the resource
   * instead of rejecting it, and only a request that genuinely went wrong becomes an
   * error the page reports.
   */
  protected readonly latest = resource({
    loader: async ({ abortSignal }) => {
      const response = await api.runs.latest.$get(undefined, { init: { signal: abortSignal } });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`the API answered ${response.status} for the latest run`);
      }
      return await response.json();
    },
  });
}
