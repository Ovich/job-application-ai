import { provideZonelessChangeDetection } from "@angular/core";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStream } from "./run-stream";

/**
 * The browser's side of the stream (US4, S3.5): what a run says while it is running,
 * as it says it. This file is written before the component exists and states its
 * contract.
 *
 * Three things are that contract. A leaf reaches the page **when it lands**, not when
 * the run ends, which is asserted by reading the document between two events rather
 * than after the last one: a component that collected the leaves and rendered them at
 * the end would pass a spec that only looked once. A frame the catalogue does not
 * describe is ignored rather than rendered or thrown on, since the wire is the one
 * input this application does not control. And the source is closed exactly once, when
 * the run ends and when the component goes away, because an `EventSource` left alone
 * reconnects and would run the whole run again.
 *
 * The leaf shapes are the API's (ID33) and are not the shapes of any table, so nothing
 * here is derived from the RPC client: an event body never travels through it. See the
 * comment on `stream-frame.ts` for why they are written down in this application.
 */

type Listener = (event: Event) => void;

/**
 * `EventSource` in place of the network. jsdom has none, and even where it has one the
 * subject here is what the component does with the events, so the test stands in for
 * the connection and lets the component be the only thing under test.
 */
class FakeEventSource {
  static readonly opened: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listening = this.listeners.get(type) ?? new Set<Listener>();
    listening.add(listener);
    this.listeners.set(type, listening);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** One event as the server wrote it, body and all. */
  deliver(data: string): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data }));
    }
  }

  /** What a browser reports when the connection ends, however it ended. */
  fail(): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener(new Event("error"));
    }
  }
}

/** A frame as the envelope writes one: the frame's own sequence, the catalogue, a leaf. */
const frame = (seq: number, leaf: unknown) => JSON.stringify({ seq, version: 1, leaf });

const textFrame = (seq: number, text: string) => frame(seq, { kind: "text", text });

/** `seq` inside a progress leaf is the unit's place in the run, not the frame's. */
const progressFrame = (seq: number, unit: number, status: string) =>
  frame(seq, { kind: "progress", seq: unit, status });

const runId = "0d5c0a2c-8f1b-4a1e-9f3a-2f7d5b1c9e40";

/** The connection the component most recently opened. */
function source(): FakeEventSource {
  const opened = FakeEventSource.opened.at(-1);
  if (!opened) {
    throw new Error("the component opened no stream");
  }
  return opened;
}

/** Every row's text, whitespace flattened, in the order the document has them. */
function rowsOf(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("li"), (row) =>
    (row.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("RunStream", () => {
  let fixture: ComponentFixture<RunStream>;

  /** The component, rendered on a run, with its first render settled. */
  async function renderStream(id = runId): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RunStream);
    fixture.componentRef.setInput("runId", id);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** What the document says once the events just delivered have been rendered. */
  async function settled(): Promise<HTMLElement> {
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    FakeEventSource.opened.length = 0;
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the run's stream", async () => {
    await renderStream();

    expect(FakeEventSource.opened).toHaveLength(1);
    expect(source().url).toBe(`/api/runs/${runId}/stream`);
  });

  it("shows each leaf as it lands, in the order it landed", async () => {
    await renderStream();

    source().deliver(textFrame(1, "unit 1 of 2\n"));
    expect(rowsOf(await settled())).toEqual(["unit 1 of 2"]);

    source().deliver(progressFrame(2, 1, "done"));
    source().deliver(textFrame(3, "unit 2 of 2\n"));
    expect(rowsOf(await settled())).toEqual([
      "unit 1 of 2",
      expect.stringMatching(/\b1\b.*\bdone\b/),
      "unit 2 of 2",
    ]);
  });

  it("renders a progress leaf for each status the catalogue holds", async () => {
    await renderStream();

    source().deliver(progressFrame(1, 1, "done"));
    source().deliver(progressFrame(2, 2, "failed"));
    source().deliver(progressFrame(3, 3, "pending"));

    expect(rowsOf(await settled())).toEqual([
      expect.stringMatching(/\b1\b.*\bdone\b/),
      expect.stringMatching(/\b2\b.*\bfailed\b/),
      expect.stringMatching(/\b3\b.*\bpending\b/),
    ]);
  });

  it("ignores anything it cannot read, and keeps reading", async () => {
    await renderStream();

    source().deliver("not json at all");
    source().deliver(frame(1, { kind: "sparkline", points: [1, 2] }));
    source().deliver(frame(2, { kind: "progress", seq: 1, status: "elsewhere" }));
    source().deliver(JSON.stringify({ seq: 3, version: 2, leaf: { kind: "text", text: "later" } }));
    expect(rowsOf(await settled())).toEqual([]);

    source().deliver(textFrame(4, "still here"));
    expect(rowsOf(await settled())).toEqual(["still here"]);
  });

  it("ends the run when the stream ends, and does not reconnect", async () => {
    const ended = vi.fn();
    const page = await renderStream();
    fixture.componentInstance.ended.subscribe(ended);

    source().deliver(progressFrame(1, 1, "done"));
    await settled();
    source().fail();

    expect(source().closed).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
    expect((await settled()).textContent).toMatch(/finished/i);
    expect(rowsOf(page)).toHaveLength(1);
  });

  it("says so when the stream fails before saying anything", async () => {
    const ended = vi.fn();
    await renderStream();
    fixture.componentInstance.ended.subscribe(ended);

    source().fail();

    expect(source().closed).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    expect((await settled()).textContent).toMatch(/could not be read/i);
  });

  it("starts over on another run, and drops the stream of the old one", async () => {
    await renderStream();
    source().deliver(textFrame(1, "the first run"));
    await settled();

    const first = source();
    fixture.componentRef.setInput("runId", "3b9d1f5a-2c44-4e18-8a77-5d0e9c6b2af1");
    const page = await settled();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.opened).toHaveLength(2);
    expect(source().url).toMatch(/3b9d1f5a-2c44-4e18-8a77-5d0e9c6b2af1\/stream$/);
    expect(rowsOf(page)).toEqual([]);
  });

  it("closes the stream when the page moves on", async () => {
    await renderStream();

    fixture.destroy();

    expect(source().closed).toBe(true);
  });
});
