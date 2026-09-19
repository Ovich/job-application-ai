import type { BaseMessage } from "@langchain/core/messages";
import { SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { budgetOf } from "./context";
import type {
  AssistantDefinition,
  ConversationAgentOptions,
  ConversationRef,
  Ran,
  StoredEntry,
} from "./index";
import { asMessages } from "./messages";
import { contextSchemaFor, stepMiddleware, type Wiring } from "./step";

/**
 * The conversation agent (`ID179`, `ID186`, `ID187`, `ID188`, OD1), managed by LangGraph
 * (D18): one instance, built once from the model, the store and the transaction it is
 * handed, and asked for one message at a time.
 *
 * It is the whole surface of this module. Nothing of the graph, the middleware, the step
 * count, the transaction per step or the stream mapping leaves the constructor.
 */

/** The header each step names its case in, when the binding names none. */
const defaultCaseHeader = "x-agent-case";

/** How a step's case reads, when the binding words none: `<assistant>.message:<id>#<n>`. */
const defaultCaseOf = (assistant: string, conversation: string, step: number): string =>
  `${assistant}.message:${conversation}#${step}`;

/** How many steps one message may take (`ID180`), when the binding names none. */
const defaultSteps = 5;

/** The last entry when the limit is reached. What the steps committed stays. */
const defaultStopped = (steps: number): string =>
  `I stopped here: one message may take ${steps} steps and I reached that limit. What I changed so far is kept.`;

/** The graph for a definition (spec 3.4). */
const buildGraph = <Tx, C extends ConversationRef, E extends StoredEntry>(
  model: ConversationAgentOptions<Tx, C, E>["model"],
  definition: AssistantDefinition<Tx>,
  wiring: Wiring<Tx, C, E>,
  contextSchema: ReturnType<typeof contextSchemaFor<C>>,
) =>
  createAgent({
    model,
    // A message of one string, as the loop sent it: a plain string would become a list of
    // text blocks on the wire. An empty prompt still sends nothing (`AgentNode.js:149`).
    systemPrompt: new SystemMessage(definition.prompt),
    tools: definition.tools.map((each) =>
      tool(
        () => {
          // Never reached, and it must stay a throw (D21). See `step.ts`.
          throw new Error("never run: the step middleware runs every tool");
        },
        { name: each.name, description: each.description, schema: each.input as never },
      ),
    ),
    contextSchema,
    middleware: [stepMiddleware(definition, wiring, contextSchema)],
    name: definition.name,
  });

export class ConversationAgent<Tx, C extends ConversationRef, E extends StoredEntry> {
  /** How many steps one message may take, as configured. */
  readonly steps: number;

  private readonly model: ConversationAgentOptions<Tx, C, E>["model"];
  private readonly wiring: Wiring<Tx, C, E>;
  private readonly contextSchema = contextSchemaFor<C>();
  /**
   * One graph per definition: stateless without a checkpointer, so one serves every
   * request. The cache is this instance's (`ID284`, OD1), so two agents share nothing.
   */
  private readonly graphs = new Map<
    AssistantDefinition<Tx>,
    ReturnType<typeof buildGraph<Tx, C, E>>
  >();

  constructor(options: ConversationAgentOptions<Tx, C, E>) {
    this.model = options.model;
    this.steps = options.steps ?? defaultSteps;
    const budget = this.budgetOf(options);
    this.wiring = {
      store: options.store,
      transaction: options.transaction,
      caseHeader: options.caseHeader ?? defaultCaseHeader,
      caseOf: options.caseOf ?? defaultCaseOf,
      steps: this.steps,
      stopped: options.stopped ?? defaultStopped,
      model: options.model,
      budget,
    };
  }

  /**
   * The input budget (D35): the binding's `context`, else the model's own profile; with
   * neither, the agent is not built, and the error names the model and the option.
   */
  private budgetOf(options: ConversationAgentOptions<Tx, C, E>): number {
    return budgetOf(options.model, options.context);
  }

  private graphOf(definition: AssistantDefinition<Tx>) {
    const known = this.graphs.get(definition);
    if (known !== undefined) return known;
    const built = buildGraph(this.model, definition, this.wiring, this.contextSchema);
    this.graphs.set(definition, built);
    return built;
  }

  /**
   * What changed outside the conversation, pushed into its history (D34): one `system`
   * entry holding one `notice` part, appended through the store in the agent's own
   * transaction (D21) and resolved once it committed. No model is asked and nothing is
   * streamed; the model reads the notice at its place the next time it is asked. An empty
   * text is refused before anything is written.
   */
  async notify(conversation: C, text: string): Promise<E> {
    if (text.trim() === "") throw new Error("a notice says something: its text is empty");
    return this.wiring.transaction((tx) =>
      this.wiring.store.append(tx, conversation, "system", [{ kind: "notice", text }]),
    );
  }

  /**
   * One message through the agent (spec 3.6): the stored entries as its input (D11, D20),
   * then what the graph streams, mapped onto `Ran` in the order it arrives. The step
   * middleware's `custom` events are already `Ran`s; the model node's text pieces become
   * `text` (D28). Both modes are needed: `messages` is what makes the model stream at all.
   *
   * A failed call, or a step whose transaction fails, throws after yielding what earlier
   * steps committed; nothing of the failed step is written.
   */
  async *run(
    definition: AssistantDefinition<Tx>,
    conversation: C,
    person: string,
  ): AsyncIterable<Ran<E>> {
    const entries: StoredEntry[] = await this.wiring.store.entries(conversation);
    const window = await this.wiring.store.window(conversation);
    const messages = asMessages(entries, definition.describe);
    const stream = await this.graphOf(definition).stream(
      { messages },
      {
        context: { person, conversation, ledger: { entries: [...entries], window } },
        streamMode: ["messages", "custom"],
        // A safety net a run never reaches: `beforeModel` ends it after `steps` steps.
        recursionLimit: 10 * this.steps,
      },
    );
    for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
      if (mode === "custom") {
        yield chunk as Ran<E>;
        continue;
      }
      const [piece, metadata] = chunk as [BaseMessage, { langgraph_node?: string }];
      if (
        metadata.langgraph_node === "model_request" &&
        typeof piece.content === "string" &&
        piece.content !== ""
      ) {
        yield { kind: "text", text: piece.content };
      }
    }
  }
}
