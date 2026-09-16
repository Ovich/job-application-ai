import { Injectable, signal } from "@angular/core";
import type { InferResponseType } from "hono/client";
import { api } from "../../lib/api";

/**
 * The documents and their reading, as a service (spec D15, `ID247`): the only code in the
 * web that calls the documents and reading routes. Provided, never in root: by the
 * profile viewer for its modal, and by the `/documents` page for its own.
 *
 * **Its state is the rows.** The list route is asked when a drop zone opens and that is
 * the whole of the resume: a person who closed the tab mid-reading comes back to what
 * the database says, not to what a browser remembered. A stream that is cut is not
 * replayed; it is read again from the rows.
 *
 * What a screen tells a person about a call, a refusal or a landed reading, stays with
 * the screen: this holds what the rows and the run say, and nothing a screen draws.
 */

/** How long the green line stands before the profile opens (the person, 2026-09-12). */
const afterTheReading = 1000;

/** A row, as the list route answers it. Inferred; nothing about it is declared here. */
export type Document = InferResponseType<typeof api.intake.documents.$get, 200>[number];

/** What a leaf of the reading run says. Inferred from the catalogue the API ships. */
type Leaf = {
  kind: string;
  id?: string;
  status?: string;
  reason?: string | null;
};

/** What an add answered: the row it made, or the route's own sentence for a refusal. */
export type Added = { row: Document } | { refusal: string | null };

@Injectable()
export class Documents {
  /** The person's documents, as the rows and the run's frames last said them. */
  public readonly documents = signal<Document[]>([]);

  /**
   * Whether a run started here is still going. A reload finds it in the rows instead,
   * and the end of the stream puts it back down.
   */
  public readonly reading = signal(false);

  /**
   * How many readings have landed with every document read, counted a second after the
   * green line appears. Whoever holds the drop zone takes a change as its moment: the
   * page opens the profile, the profile closes its modal and reads itself back.
   */
  public readonly readDone = signal(0);

  /** The list route, which is the documents' whole memory; the rows, or null on a failure. */
  public async list(): Promise<Document[] | null> {
    const answer = await api.intake.documents.$get();
    if (!answer.ok) return null;
    const rows = await answer.json();
    this.documents.set(rows);
    return rows;
  }

  /** One file or one address added, and its row appended once the route has it. */
  public async add(source: File | string): Promise<Added> {
    const answer = await api.intake.documents.$post({
      form: typeof source === "string" ? { address: source } : { file: source },
    });
    const said = (await answer.json()) as Document & { error?: string };
    if (!answer.ok) return { refusal: said.error ?? null };
    this.documents.update((rows) => [...rows, said]);
    return { row: said };
  }

  public async remove(id: string): Promise<void> {
    const answer = await api.intake.documents[":id"].$delete({ param: { id } });
    if (answer.ok) this.documents.update((rows) => rows.filter((each) => each.id !== id));
  }

  /**
   * The run, read frame by frame. Each frame moves one row, because each frame is a row
   * the API has already written. When the run says it is done the list is read once more,
   * for the kinds and the languages the reader detected, which the frames do not carry.
   *
   * Answers whether every document is now read; when so, `readDone` moves a second later.
   */
  public async read(): Promise<boolean> {
    this.reading.set(true);
    const run = await api.intake.read.$post();
    const body = run.body;
    if (body === null) return false;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let held = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      held += decoder.decode(next.value, { stream: true });
      const blocks = held.split("\n\n");
      held = blocks.pop() ?? "";
      for (const block of blocks) this.apply(block);
    }

    this.reading.set(false);
    await this.list();

    const rows = this.documents();
    const allRead = rows.length > 0 && rows.every((row) => row.status === "read");
    if (allRead) {
      setTimeout(() => this.readDone.update((count) => count + 1), afterTheReading);
    }
    return allRead;
  }

  /** One block of the stream, if it carries a document's leaf. */
  private apply(block: string): void {
    const line = block.split("\n").find((each) => each.startsWith("data: "));
    if (line === undefined) return;
    let leaf: Leaf;
    try {
      leaf = (JSON.parse(line.slice("data: ".length)) as { leaf: Leaf }).leaf;
    } catch {
      return;
    }
    if (leaf.kind !== "document" || leaf.id === undefined) return;
    this.documents.update((rows) =>
      rows.map((row) =>
        row.id === leaf.id
          ? { ...row, status: leaf.status ?? row.status, failureReason: leaf.reason ?? null }
          : row,
      ),
    );
  }
}
