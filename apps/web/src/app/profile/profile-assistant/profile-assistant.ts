import { NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  Injector,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from "@angular/core";
import { Assistant } from "../../assistant/assistant/assistant";
import { AssistantConversation } from "../../assistant/assistant-conversation/assistant-conversation";
import { AssistantCore } from "../../assistant/assistant-core";
import { provideAssistant } from "../../assistant/provide-assistant";
import { guide, type Step } from "../../guide/guide";
import { atOnce, GUIDE_PACE, type GuidePace } from "../../guide/pace";
import { doThis, say, show, shownOf } from "../../guide/say";
import { ago, exactly } from "../../lib/ago";
import { UiText } from "../../ui/typography/text/text";
import { ProgressLine } from "../progress-line/progress-line";
import { ReadingCard } from "../reading-card/reading-card";
import type { OpenQuestion, OpenTool, Option } from "../scope-tool/scope-tool";
import { ScopeTool } from "../scope-tool/scope-tool";
import { profileAssistantHistory } from "./history/history";

/**
 * The assistant's column, for the intake (`S4.2`, `S4.4`, `S5.1`, `S5.2`, the mockup's
 * `ProfileAssistant`).
 *
 * **It composes the core assistant rather than being it** (`S7.4`, the person's own
 * words: *"Profile assistant is a concrete implementation of core assistant and
 * stays"*). `app/assistant/` draws the column, the dock, the prefix and the bar and
 * holds no word of any use case; everything the intake says is here — the opening, the
 * welcome, the reading card's sentences, the openers, its last words, the waiting
 * line, and `Scope`, which is the word this use case names the thing in the prefix with.
 *
 * **It performs and it triggers; it never opens a tool itself** (agent-consolidation
 * `SL8`, `ID216`). Nothing is active by default (`ID215`): the column says what it has to
 * say first, and its last step emits `activate` on the question's item, which the viewer
 * handles exactly as a press on that item. The tool, its prefix, its path and its
 * choices then follow the item the person is on, whoever put them there.
 *
 * **A region the person pressed takes precedence over the order** (`US8`). If a question
 * is still open on that very region, that is the question the tool asks; if none is, the
 * tool opens in the shape that proposes nothing and what is written is a message about
 * that item (`S8.7`). Which of the two it is, this class decides and the tool renders.
 *
 * **Returning is not the end of a run** (`US9`). Days later the assistant greets the
 * person and activates the first question still waiting: the finished run's opening is
 * not replayed, and there is no done state and no exit anywhere on this screen.
 *
 * **It is the only holder of the assistant core** (D1): it provides it, opens the
 * conversation, draws once it has answered, posts, and answers and skips through
 * `core.act` (D5, D9). The class holds the questions as an input and exposes computeds;
 * the template binds signals and reaches no service (`AGENTS.md` 3). What leaves here is
 * which item to activate, that the person's own tool was put away, and whether a decision
 * was kept, which the page relays to the viewer (D8).
 */

/** One question as the interface answers it, which is what this column is given. */
export type Question = {
  id: string;
  itemId: string;
  itemTitle: string;
  kind: string;
  where: string;
  lead: string;
  state: string;
  options: { id: string; label: string; hint: string; concern: string | null }[];
};

/**
 * The region the person is on: which item it is, and **where** it is — a name for an
 * item, and `the post · row 3` for a line. Never the line's own sentence: the sheet has
 * already lifted it, and saying it again in the tool is the same thing twice (the
 * person, 2026-09-13).
 *
 * A line carries the item it belongs to and its own id beside it, because what is
 * written about a line is kept on that item.
 */
export type Pressed = { itemId: string; where: string; lineId: string | null };

/** The word the intake names the thing in the prefix with. The builder will have its own. */
const scope = "Adjusting scope";

/**
 * What that word means, said on hover. The intake's own sentence: the chip is two words
 * and a person meeting it for the first time deserves the rest of it somewhere (the
 * person, 2026-09-13).
 */
const whatScopeMeans =
  "What you say next goes into the conversation, about this item. Nothing is sent to anyone.";

/** What the bar says while nothing is typed (D7). */
const saySomething = "Say it in your own words, or click anything in your profile";

/** What the assistant says once no question is left. Performed, never stored. */
const allNeeded = "That is all I needed.";

const profileReady =
  "Your profile is ready. Start an application, or click anything on the right to correct it.";

/** What the column says when a decision was not kept, with the tool still on it. */
const notKept = "That did not save. Your choice is still here, so try again.";

/**
 * One line the assistant performs and does not store (`ID201`): an opener, its last
 * words, a decision not kept. It is timed when it was said (`ID220`).
 */
type Line = {
  part: "opener" | "done" | "ready" | "save-failure";
  text: string;
  tone: "foreground" | "ok" | "muted";
  landed: WritableSignal<number>;
  at: Date;
  /** How many stored entries the conversation held when it was said: it reads after them. */
  after: number;
};

/**
 * Where the run stands: saying something, waiting on the person with a tool active,
 * saving their decision, or finished with nothing left to ask.
 */
type Phase = "performing" | "waiting" | "saving" | "finished";

/**
 * A decision on its way. `questions` is `null` until `core.act` has kept it, then the
 * questions the column held at that moment, which is how it tells the viewer's read-back
 * apart from what came before.
 */
type Saving = { questions: Question[] | null };

@Component({
  selector: "profile-assistant",
  // The profile's assistant, for this column alone (`ID186`, `ID165`, D1): its own
  // conversation, subject none. Its history parts are drawn by its `#part` template (D3, D4).
  providers: [provideAssistant({ name: "profile" })],
  imports: [
    Assistant,
    AssistantConversation,
    NgTemplateOutlet,
    profileAssistantHistory,
    ProgressLine,
    ReadingCard,
    ScopeTool,
    UiText,
  ],
  templateUrl: "./profile-assistant.html",
  host: { class: "flex min-h-0 min-w-0 flex-1 flex-col" },
})
export class ProfileAssistant {
  /**
   * Whether the conversation holds nothing to draw: not opened, or refused. The reading
   * card is still the profile's to show, so the column draws its opening without stored
   * words rather than nothing at all.
   */
  protected readonly nothingStored = computed(() => this.core.entries().length === 0);

  public readonly questions = input<Question[]>([]);

  /** What the bar says while nothing is typed: this use case's words, given to the core (D7). */
  protected readonly placeholder = saySomething;

  /** The region the person is on, pressed or activated. Nothing, to begin with. */
  public readonly on = input<Pressed | null>(null);

  /**
   * Whether the person put the tool down by pressing the dimmed profile (the person,
   * 2026-09-13). Nothing is written and nothing is decided; the question is still
   * waiting and opens again the moment they press a region.
   */
  public readonly dismissed = input<boolean>(false);

  /** Whether this is a visit after the reading rather than the run that produced it. */
  public readonly returning = input<boolean>(false);

  /** What the reading produced: the documents read, and the facts it can honestly count. */
  public readonly reading = input<{ documents: number; facts: number }>({
    documents: 0,
    facts: 0,
  });

  /**
   * The stored conversation this column belongs to (agent-consolidation `SL2`, `ID176`),
   * provided by this column (D1). Its first entry is the opening the API wrote.
   */
  private readonly core = inject(AssistantCore);

  /**
   * Whether the conversation has answered, with its entries or with a refusal. The column
   * draws nothing before it, because whether the opening is performed is decided from what
   * is stored, once, on its first render (`G3`).
   */
  protected readonly conversationAnswered = computed(
    () => this.core.entries().length > 0 || this.core.failure() !== null,
  );

  /** The words of one part of the opening, or nothing when the opening has no such part. */
  private readonly openingPart = (at: number): string => {
    const part = this.core.entries()[0]?.parts[at];
    return part !== undefined && "text" in part && typeof part.text === "string" ? part.text : "";
  };

  /** The opening's first sentence, as stored, and how much of it has landed. */
  protected readonly opening = computed(() => this.openingPart(0));

  protected readonly openingShown = computed(() => shownOf(this.opening(), this.told()));

  /** The sentence after the card, as stored, and how much of it has landed. */
  protected readonly tail = computed(() => this.openingPart(1));

  protected readonly tailShown = computed(() => shownOf(this.tail(), this.toldTail()));

  /**
   * The person-opened tool put away: written about an item nobody asked about (`US8`), or
   * one of its lines, and posted, or cancelled with nothing written.
   */
  public readonly closed = output<void>();

  /** A decision made through the tool, and whether `core.act` kept it (D5). */
  public readonly decided = output<{ kept: boolean }>();

  /**
   * The item whose question's tool the assistant activates (`ID216`): the viewer handles
   * it as a press on that item, so what activation does is the tool's own.
   */
  public readonly activate = output<{ itemId: string }>();

  private readonly assistant = viewChild(Assistant);

  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly pace = inject(GUIDE_PACE);

  /**
   * How much of the opening has landed (`2026-09-13-guided-effects.spec.md`).
   *
   * The column starts empty and fills the way an answer does: the first sentence a word
   * at a time, the reading card as one beat (`G5`), the second sentence, the opener, and
   * only then the tool. A person arriving learns that this column is a conversation by
   * watching it be one — which no sentence explaining it would achieve.
   */
  protected readonly told = signal(0);

  protected readonly toldTail = signal(0);

  protected readonly card = signal(false);

  /** What the assistant has said on this visit and not stored: its openers and its answers. */
  protected readonly turn = signal<Line[]>([]);

  private readonly phase = signal<Phase>("performing");

  /** The decision on its way, or `null`. A field: only the read-back it waits for is reactive. */
  private saving: Saving | null = null;

  /** The sequence running now, so it can be abandoned when the column goes. */
  private performance: AbortController | null = null;

  private gone = false;

  /** Which row of the open question the person has picked, if any. */
  protected readonly picked = signal<string | null>(null);

  protected readonly total = computed(() => this.questions().length);

  protected readonly answeredCount = computed(
    () => this.questions().filter((question) => question.state === "answered").length,
  );

  /** What the person put off, which is what the count calls "for the builder" (`US7`). */
  protected readonly deferred = computed(
    () => this.questions().filter((question) => question.state === "skipped").length,
  );

  protected readonly waiting = computed(() =>
    this.questions().filter((question) => question.state === "waiting"),
  );

  protected readonly left = computed(() => this.waiting().length);

  /**
   * The questions nobody has answered yet, skipped ones included. A skipped question
   * still marks its item `scope to clarify`, so the item still requires clarification and a
   * press on it reopens the question with its rows rather than the tool that proposes
   * nothing (the person, 2026-09-13). The assistant's own order is over `waiting` alone:
   * a skipped question is put off until the builder, never asked again unprompted.
   */
  private readonly stillOpen = computed(() =>
    this.questions().filter((question) => question.state !== "answered"),
  );

  /**
   * The question whose tool is active: the one still open on the item the person is on,
   * pressed or activated, and nothing otherwise (`ID215`). A line has no question of its
   * own, so being on one never opens its item's.
   */
  protected readonly open = computed(() => {
    const pressed = this.on();
    if (pressed === null || pressed.lineId !== null) return null;
    return this.stillOpen().find((question) => question.itemId === pressed.itemId) ?? null;
  });

  /** The region the person pressed and no question is waiting on: their own tool. */
  protected readonly clarifying = computed(() => {
    const pressed = this.on();
    return pressed === null || this.open() !== null ? null : pressed;
  });

  /**
   * The greeting a second visit opens on, in place of the run's own opening (`US9`, the
   * mockup's returning variant). The run that produced this profile is not replayed: what
   * a person coming back needs is what is still waiting.
   */
  protected readonly welcome = computed(() => {
    if (!this.returning()) return "";
    const things = this.left();
    return `Welcome back. ${things} thing${things === 1 ? "" : "s"} I still could not tell from your documents.`;
  });

  /** The question in the shape the tool takes it, four answers at most by the type. */
  private readonly question = computed<OpenQuestion | null>(() => {
    const question = this.open();
    if (question === null) return null;
    const [first, second, third, fourth] = question.options as [Option?, Option?, Option?, Option?];
    if (first === undefined) return null;
    const options =
      fourth !== undefined && third !== undefined && second !== undefined
        ? ([first, second, third, fourth] as const)
        : third !== undefined && second !== undefined
          ? ([first, second, third] as const)
          : second !== undefined
            ? ([first, second] as const)
            : ([first] as const);
    return { kind: "asked", where: question.where, lead: question.lead, options };
  });

  /**
   * What is open in the dock. A clarification carries where the person is and no option,
   * which is what makes the shape that proposes nothing unable to propose.
   */
  protected readonly asked = computed<OpenTool | null>(() => {
    const pressed = this.clarifying();
    if (pressed !== null) return { kind: "clarification", where: pressed.where };
    // Put down by a press on the dimmed profile, and staying down until a region is
    // pressed again.
    if (this.dismissed()) return null;
    return this.question();
  });

  /**
   * What the prefix says, and what hovering it explains: this use case's own word and
   * its own sentence, supplied here and nowhere in core — which is what "concrete tool
   * prefixes per use case" means. Nothing a document wrote appears in either.
   *
   * **Where a person is travels with it** (the person, 2026-09-14): the path — an item's
   * name, or a post and a row — is the composer's to show, between the tool and the bar
   * while the bar is one line and inside the bar once it is many.
   */
  protected readonly tool = computed(() => {
    const pressed = this.clarifying();
    if (pressed !== null) return { label: scope, describes: whatScopeMeans, where: pressed.where };
    const question = this.open();
    return question === null
      ? null
      : { label: scope, describes: whatScopeMeans, where: question.where };
  });

  /**
   * The conversation's last line while a question's tool is active (`ID218`): which tool,
   * on what, waiting for the person. Drawn, never stored, and not an entry.
   */
  protected readonly waitingLine = computed(() => {
    const question = this.open();
    if (question === null || this.dismissed()) return "";
    return `${scope} on ${question.itemTitle} is waiting for your choice.`;
  });

  /**
   * The time the phrases are said from, read again once a minute while the column is on
   * the screen (`ID220`).
   */
  private readonly now = signal(new Date());

  /** When the column was first drawn, for an opening nothing stored. */
  private drawnAt = new Date();

  /** When the opening was written: as stored, or when it was drawn if nothing is. */
  protected readonly openingAt = computed(() => {
    const stored = this.core.entries()[0]?.createdAt;
    return stored === undefined ? this.drawnAt : new Date(stored);
  });

  constructor() {
    const every = setInterval(() => this.now.set(new Date()), 60 * 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(every);
      this.gone = true;
      this.performance?.abort();
    });

    /**
     * The profile's conversation, opened with the opening the API writes the first time
     * (agent-consolidation SL2). The page draws this column once a reading has made a
     * profile (`ID202`: no assistant during the intake).
     */
    void this.core.open();

    /**
     * The intake's own guided sequence, run on the column's **first render** once the
     * conversation has answered (`G3`).
     *
     * Every visit, not once per person, and not again while they stay. The steps are this
     * use case's words and this use case's tool — `app/guide/` holds none of them.
     *
     * A person who types, clicks or scrolls abandons the performance and keeps
     * everything: the words whole, the card shown, the tool activated (`G2`).
     */
    const injector = inject(Injector);
    let drawn = false;
    effect(() => {
      if (drawn || !this.conversationAnswered()) return;
      drawn = true;
      untracked(() => {
        this.drawnAt = new Date();
        afterNextRender(() => this.firstRender(), { injector });
      });
    });

    /**
     * A kept decision read back (`ID217`): the viewer reads the profile again, and once its
     * questions have arrived the column stops thinking and moves on.
     */
    effect(() => {
      const questions = this.questions();
      const saving = this.saving;
      if (saving === null || saving.questions === null || questions === saving.questions) return;
      untracked(() => this.readBack());
    });

    /**
     * The person's own tool put away — a clarification written or cancelled — while a
     * question was waiting on them: the assistant is back on that question, activated
     * the same way. Putting the tool down on the dimmed profile is not this, and leaves
     * it down.
     */
    let was: Pressed | null = null;
    effect(() => {
      const on = this.on();
      const dismissed = this.dismissed();
      const before = was;
      was = on;
      if (before === null || on !== null || dismissed) return;
      untracked(() => {
        const next = this.waiting()[0];
        if (this.phase() === "waiting" && next !== undefined) this.activateOn(next.itemId);
      });
    });
  }

  /** The column's first render: the opening performed, or everything landed at once. */
  private firstRender(): void {
    /**
     * **Only a brand new chat is performed** (the person, 2026-09-13).
     *
     * A conversation that already has something in it — a person coming back, a
     * question already answered or put off — is a conversation being resumed, and
     * typing its first line out again would be the interface pretending to think about
     * something it has already said. Everything lands at once instead, and the tool is
     * still activated.
     */
    if (!this.brandNew()) {
      this.told.set(Number.POSITIVE_INFINITY);
      this.card.set(true);
      this.toldTail.set(Number.POSITIVE_INFINITY);
      this.atOnce(this.turnSteps(atOnce, true));
      return;
    }
    const pace = this.currentPace();
    this.perform([
      say("opening", this.opening(), this.told, pace),
      show("card", this.card, pace),
      say("tail", this.tail(), this.toldTail, pace),
      ...this.turnSteps(pace, true),
    ]);
  }

  /**
   * Whether the conversation holds its opening and nothing after it (`ID176`). Only then
   * is the opening performed; a conversation with more in it is resumed, shown at once.
   */
  private brandNew(): boolean {
    return this.core.entries().length === 1;
  }

  /** What a person asked for when they asked for less motion (`G6`). */
  private reduced(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  private currentPace(): GuidePace {
    return this.reduced() ? atOnce : this.pace;
  }

  /** The lines said once `after` stored entries were in the conversation, in order (`ID227`). */
  protected saidAfter(after: number): Line[] {
    return this.turn().filter((line) => line.after === after);
  }

  /** A line's words, as far as they have landed. */
  protected shown(line: Line): string {
    return shownOf(line.text, line.landed());
  }

  /** When a line was said, or the opening stored, as a phrase: `just now`. */
  protected when(at: Date): string {
    return ago(at, this.now());
  }

  /** The full date and time, for the hover. */
  protected exactlyWhen(at: Date): string {
    return exactly(at);
  }

  /**
   * What the assistant says on a turn, and what it does last (`G3`, amended 2026-09-14):
   * the next question's opener and the activation of its tool — or, with no question
   * left, that it has all it needs, and nothing activated.
   *
   * **The opener is the opening turn's alone** (`ID293`): after a kept decision the
   * agent's reply is the one reply, so the column says nothing of its own and only
   * activates the next question's tool, which is how a reload reads.
   */
  private turnSteps(pace: GuidePace, opening: boolean): Step[] {
    const next = this.waiting()[0];
    if (next === undefined) {
      return [
        this.line("done", allNeeded, "ok", pace),
        this.line("ready", profileReady, "foreground", pace),
        doThis("finished", () => this.phase.set("finished"), atOnce),
      ];
    }
    const activate = doThis("activate", () => this.activateOn(next.itemId), pace);
    if (!opening) return [activate];
    const moved = this.answeredCount() + this.deferred() > 0;
    return [
      this.line("opener", `${moved ? "Next" : "First"}, ${next.itemTitle}.`, "foreground", pace),
      activate,
    ];
  }

  /** One performed line, added to the turn as it begins to land and timed then. */
  private line(part: Line["part"], text: string, tone: Line["tone"], pace: GuidePace): Step {
    return {
      name: part,
      run: async (abandoned) => {
        const landed = signal(0);
        const after = this.core.entries().length;
        this.turn.update((lines) => [
          ...lines,
          { part, text, tone, landed, at: new Date(), after },
        ]);
        await say(part, text, landed, pace).run(abandoned);
      },
    };
  }

  /** The steps performed, the host carrying which one is running (`G8`). */
  private perform(steps: Step[]): void {
    this.phase.set("performing");
    this.performance = guide(steps, this.host.nativeElement as HTMLElement);
  }

  /**
   * The steps landed at once, nothing performed and nothing written on the host. At a
   * pace of zero a step lands before its first pause, so each is started in order and
   * none is waited on: everything is on the screen in the render that follows.
   */
  private atOnce(steps: Step[]): void {
    this.phase.set("performing");
    const never = new AbortController().signal;
    for (const step of steps) void step.run(never);
  }

  /** The sequence's last step, and nothing else: the tool on that item, triggered. */
  private activateOn(itemId: string): void {
    this.phase.set("waiting");
    if (!this.gone) this.activate.emit({ itemId });
  }

  /**
   * A decision leaves through `core.act` (D5, D9): the column thinks until it is kept, the
   * agent's reply to it has streamed (D31), and the viewer has read the profile back
   * (`ID217`); its last words, if no question is left, read after that reply. Not kept, the conversation is read
   * again as it always was after a decision, and the column says so with the tool still on
   * the pick and the words.
   */
  private async decide(
    action: "answer_question" | "skip_question",
    input: { questionId: string; optionId?: string; words?: string },
  ): Promise<void> {
    const saving: Saving = { questions: null };
    this.saving = saving;
    this.phase.set("saving");
    this.core.showActivity("Thinking");
    const kept = await this.core.act(action, input);
    if (this.gone) return;
    if (kept) {
      // The agent's reply has ended (D31) and cleared what it was doing; the column still
      // thinks until the viewer's read-back has arrived (`ID217`).
      this.core.showActivity("Thinking");
      saving.questions = this.questions();
      this.decided.emit({ kept: true });
      return;
    }
    await this.core.reload();
    if (this.gone) return;
    this.saving = null;
    this.core.showActivity(null);
    this.phase.set("waiting");
    this.turn.update((lines) => [
      ...lines.filter((line) => line.part !== "save-failure"),
      {
        part: "save-failure",
        text: notKept,
        tone: "muted",
        landed: signal(Number.POSITIVE_INFINITY),
        at: new Date(),
        after: this.core.entries().length,
      },
    ]);
    this.decided.emit({ kept: false });
  }

  /** A kept decision, once the viewer's read-back has arrived: the column moves on. */
  private readBack(): void {
    this.saving = null;
    this.core.showActivity(null);
    this.forget();
    // The lines said before stay for the visit (`ID227`); only a failure the decision has
    // since overcome goes.
    this.turn.update((lines) => lines.filter((line) => line.part !== "save-failure"));
    this.perform(this.turnSteps(this.currentPace(), false));
  }

  protected pick(chosen: { optionId: string }): void {
    this.picked.set(chosen.optionId);
  }

  /**
   * Save: the row that was picked, with the words that were typed if any (`US6`) — or,
   * in the tool the person opened themselves, the words alone, posted as a message about
   * that item or line (`US8`, agent-consolidation `S8.7`).
   *
   * **Words with no pick are a free message** (agent-consolidation `SL3`, `US2`, `US3`):
   * posted into the conversation, with nothing open or with a question open, which then
   * stays open and moves no count.
   */
  protected save(): void {
    const words = this.assistant()?.draft().trim() ?? "";
    const pressed = this.clarifying();
    if (pressed !== null) {
      if (words === "") return;
      void this.core.post(words, {
        itemId: pressed.itemId,
        ...(pressed.lineId === null ? {} : { lineId: pressed.lineId }),
      });
      this.closed.emit();
      this.forget();
      return;
    }
    const question = this.open();
    const optionId = this.picked();
    if (question === null || optionId === null) {
      if (words === "") return;
      void this.core.post(words);
      this.forget();
      return;
    }
    if (this.phase() === "saving") return;
    void this.decide("answer_question", {
      questionId: question.id,
      optionId,
      ...(words === "" ? {} : { words }),
    });
  }

  /**
   * Skip, and the prefix's × while a question waits, which the handoff note makes the
   * same gesture: the current question is put off and the assistant moves on. On the
   * tool the person opened themselves the same gesture is Cancel, and it writes nothing.
   */
  protected skip(): void {
    if (this.clarifying() !== null) {
      this.closed.emit();
      this.forget();
      return;
    }
    const question = this.open();
    if (question === null || this.phase() === "saving") return;
    void this.decide("skip_question", { questionId: question.id });
  }

  private forget(): void {
    this.picked.set(null);
    this.assistant()?.clearDraft();
  }
}
