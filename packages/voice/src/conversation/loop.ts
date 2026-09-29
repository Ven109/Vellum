import { classify } from "./llm.js";
import type { Llm } from "./llm.js";
import type { Segment } from "./intent.js";
import { applyTurn, emptyConversation } from "./state.js";
import type { ConversationState, TurnPlan, WriteAction } from "./state.js";

export interface TurnResult {
  turnId: string;
  segments: Segment[];
  classifiedBy: "model" | "rules";
  plan: TurnPlan;
}

let seq = 0;
const turnId = () => `turn_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * The core loop: holds the conversation, sorts each turn into content, constraints, steering and
 * thinking aloud, and hands the writer the actions to carry out.
 */
export class ConversationLoop {
  state: ConversationState;
  private listeners = new Set<(s: ConversationState) => void>();

  constructor(
    private readonly options: { llm?: Llm; timeoutMs?: number } = {},
    initial: ConversationState = emptyConversation(),
  ) {
    this.state = initial;
  }

  subscribe(fn: (s: ConversationState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  async handleTurn(text: string, at = Date.now()): Promise<TurnResult> {
    const id = turnId();
    const { segments, by } = await classify(text, { ...this.options, state: this.state });
    const { state, plan } = applyTurn(this.state, { id, text, at }, segments);
    this.state = state;
    this.emit();
    return { turnId: id, segments, classifiedBy: by, plan };
  }

  /** Record what the agent said (so the model sees the whole exchange). */
  agentSaid(text: string, at = Date.now()) {
    this.state = {
      ...this.state,
      turns: [...this.state.turns, { id: turnId(), speaker: "agent", text, at }],
    };
    this.emit();
  }

  /** The writer edited a constraint chip. */
  updateConstraint(id: string, patch: { label?: string; value?: string }) {
    this.state = {
      ...this.state,
      constraints: this.state.constraints.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    this.emit();
  }

  removeConstraint(id: string) {
    this.state = { ...this.state, constraints: this.state.constraints.filter((c) => c.id !== id) };
    this.emit();
  }
}

export type { WriteAction };
