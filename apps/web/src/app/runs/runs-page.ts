import { ChangeDetectionStrategy, Component, resource, signal } from "@angular/core";
import { api } from "../lib/api";
import { HlmButton } from "../ui/hlm-button";
import { DoneUnit } from "./done-unit";
import { FailedUnit } from "./failed-unit";
import { NoRunYet } from "./no-run-yet";
import { PendingUnit } from "./pending-unit";
import { RunStream } from "./run-stream";
import { RunSummary } from "./run-summary";

/**
 * The run the button starts. Four units so the run takes long enough to be watched
 * rather than glimpsed, and a kind that says where it came from. Both are the page's
 * own choice and neither is a product decision: there is one kind of run so far, and
 * the day a person picks what to run, this is what that choice replaces.
 */
const demonstrationRun = { kind: "stream-demo", units: 4 } as const;

/**
 * The latest run and its units (US3, US6): the first screen there is, and the one that
 * proves the chain from the database to the browser end to end.
 *
 * The run is read through the RPC client inside a `resource` loader (rule 14), so the
 * shape rendered here is the one the API sends, inferred, with nothing declared in
 * between (rule 4). A state is a component, never a class string chosen by an `if`:
 * the page names what it renders and the leaf holds the utilities (rule 16).
 *
 * Since S3.5 the page can also start a run and watch it (US4). The stored run above is
 * what a run leaves behind, the stream below is the run happening, and they are kept
 * apart on purpose: when the stream says the run is over, the page reads the run again
 * rather than promoting what it watched into what it knows.
 */
@Component({
  selector: "app-runs-page",
  imports: [DoneUnit, FailedUnit, HlmButton, NoRunYet, PendingUnit, RunStream, RunSummary],
  host: { class: "block" },
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between gap-4">
          <h1 class="text-figure font-semibold">Latest run</h1>
          <button hlmBtn type="button" [disabled]="started.isLoading()" (click)="start()">
            Start a run
          </button>
        </div>
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

      @if (started.error()) {
        <p class="text-caption text-danger">The run could not be started.</p>
      }
      @if (started.value(); as run) {
        <section class="flex flex-col gap-2">
          <h2 class="text-ui font-semibold">What the run said, as it said it</h2>
          <run-stream [runId]="run.id" (ended)="latest.reload()" />
        </section>
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

  /**
   * How many times a run has been asked for. A resource loads from its parameters, and
   * a button press is not a parameter, so the press is counted and the count is what
   * the loader keys on: pressing again starts another run rather than answering with
   * the last one. Zero means nobody has pressed, and the resource stays idle.
   */
  private readonly requested = signal(0);

  /**
   * The run this page started, if it started one. It is created through the same client
   * and the same route as everything else (rule 14), so the payload hash the deployed
   * distribution will demand is already on the request.
   */
  protected readonly started = resource({
    params: () => (this.requested() === 0 ? undefined : this.requested()),
    loader: async ({ abortSignal }) => {
      const response = await api.runs.$post(
        { json: { kind: demonstrationRun.kind, units: demonstrationRun.units } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) {
        throw new Error(`the API answered ${response.status} when starting a run`);
      }
      return await response.json();
    },
  });

  protected start(): void {
    this.requested.update((times) => times + 1);
  }
}
