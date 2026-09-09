import { ChangeDetectionStrategy, Component, effect, input, output, signal } from "@angular/core";
import { ProgressLeaf } from "./progress-leaf";
import { readLeaf, type StreamedLeaf } from "./stream-frame";
import { TextLeaf } from "./text-leaf";

/**
 * A run as it happens (US4): the browser's consumer of the stream, and the renderer of
 * what it carries. One component, because the two are the same subject seen twice, and
 * splitting them would mean a service holding a signal a component only forwards.
 *
 * The connection is an `EventSource` on a relative path, which is the same treatment
 * the RPC client gives every other call (ID5): the dev server forwards `/api`, one
 * distribution serves both in the cloud, so nothing here learns a host.
 *
 * Zoneless matters in this file more than anywhere else in the application. An event
 * arrives outside anything Angular knows about, so what it updates is a signal and the
 * view follows from that alone; a plain field would leave the page showing the run's
 * first moment for the whole of the run.
 */
@Component({
  selector: "run-stream",
  imports: [ProgressLeaf, TextLeaf],
  host: { class: "flex flex-col gap-2" },
  template: `
    @if (leaves().length > 0) {
      <ul
        class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card"
      >
        @for (leaf of leaves(); track $index) {
          @switch (leaf.kind) {
            @case ("text") {
              <li textLeaf [text]="leaf.text"></li>
            }
            @case ("progress") {
              <li progressLeaf [seq]="leaf.seq" [status]="leaf.status"></li>
            }
          }
        }
      </ul>
    }

    @switch (state()) {
      @case ("streaming") {
        <p class="text-caption text-muted-foreground">The run is going&hellip;</p>
      }
      @case ("finished") {
        <p class="text-caption text-muted-foreground">The run finished.</p>
      }
      @case ("failed") {
        <p class="text-caption text-danger">The run's stream could not be read.</p>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunStream {
  /** The run to follow. Pointing this at another run drops the first one's stream. */
  readonly runId = input.required<string>();

  /**
   * The run is over. What the run left behind is read from the database, not from the
   * stream, so the page above reloads rather than keeping what it saw here.
   */
  readonly ended = output<void>();

  /** Everything read so far, in arrival order, which is the order it is rendered in. */
  protected readonly leaves = signal<readonly StreamedLeaf[]>([]);

  /** Where the connection stands, in the terms the page says it in. */
  protected readonly state = signal<"streaming" | "finished" | "failed">("streaming");

  constructor() {
    effect((onCleanup) => {
      const runId = this.runId();
      this.leaves.set([]);
      this.state.set("streaming");

      const source = new EventSource(`/api/runs/${runId}/stream`);

      // Counted here rather than read back off the signal, so nothing in this callback
      // can be mistaken for a dependency of the effect that opened the connection.
      let read = 0;

      source.addEventListener("message", (event) => {
        const data: unknown = event.data;
        if (typeof data !== "string") {
          return;
        }
        const leaf = readLeaf(data);
        if (!leaf) {
          return;
        }
        read += 1;
        this.leaves.update((seen) => [...seen, leaf]);
      });

      // A server that has said everything closes the stream, and a browser reports that
      // exactly as it reports a connection that broke: as an error, followed by a
      // reconnection it makes on its own. Reconnecting would run the whole run again,
      // so the source is closed here in both cases, and what was read tells the two
      // apart. Slice 4 is what makes a resumed run resumable, and it can then say
      // where it stopped instead of guessing from a count.
      source.addEventListener("error", () => {
        source.close();
        if (read > 0) {
          this.state.set("finished");
          this.ended.emit();
          return;
        }
        this.state.set("failed");
      });

      // Runs when the run changes and when the page moves on. A stream left open goes
      // on costing a connection at both ends for a page nobody is looking at.
      onCleanup(() => {
        source.close();
      });
    });
  }
}
