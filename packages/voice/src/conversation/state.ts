import { newConstraintId } from "./intent.js";
import type { Constraint, Intent, Segment } from "./intent.js";

export interface Turn {
  id: string;
  speaker: "you" | "agent";
  text: string;
  /** ms since the epoch. */
  at: number;
  intents?: Intent[];
}

export interface ConversationState {
  /** What the piece is, as described so far. */
  brief: string[];
  constraints: Constraint[];
  turns: Turn[];
}

export const emptyConversation = (): ConversationState => ({ brief: [], constraints: [], turns: [] });

/**
 * A change to the document the loop wants made. The writer (VEL-43) carries these out in the live
 * document; nothing here touches the document itself.
 */
export type WriteAction =
  /** Put these exact words in. */
  | { type: "insert"; text: string; position: "start" | "end" | "cursor"; turnId: string }
  /** Write new text from the brief, the constraints and what was said. */
  | { type: "compose"; instruction: string; material: string[]; turnId: string }
  /** Change existing text as asked. */
  | { type: "revise"; instruction: string; turnId: string };

/** Constraints replace earlier ones of the same kind (a new length limit supersedes the old one). */
export function mergeConstraint(list: Constraint[], c: Omit<Constraint, "id">): Constraint[] {
  const replaces = (x: Constraint) =>
    x.kind === c.kind &&
    (x.kind === "length" ||
      x.kind === "tone" ||
      x.kind === "person" ||
      x.kind === "title" ||
      x.kind === "audience");
  const next = list.filter((x) => !replaces(x) && x.source !== c.source);
  return [...next, { ...c, id: newConstraintId() }];
}

export interface TurnPlan {
  actions: WriteAction[];
  /** A short spoken or shown acknowledgement, when one helps. Silence is fine for plain content. */
  reply: string | null;
}

/** Decide what to do about one turn and fold it into the state. Pure: returns the new state. */
export function applyTurn(
  state: ConversationState,
  turn: { id: string; text: string; at: number },
  segments: Segment[],
): { state: ConversationState; plan: TurnPlan } {
  let constraints = state.constraints;
  const brief = [...state.brief];
  const actions: WriteAction[] = [];
  const replies: string[] = [];
  let material: string[] = [];

  const flushMaterial = () => {
    if (!material.length) return;
    actions.push({
      type: "compose",
      instruction: "Work these points into the draft in the writer's own words where they fit.",
      material,
      turnId: turn.id,
    });
    material = [];
  };

  for (const seg of segments) {
    switch (seg.intent) {
      case "thinking":
        break;
      case "constraint":
        if (seg.constraint) {
          constraints = mergeConstraint(constraints, seg.constraint);
          replies.push(`${seg.constraint.label}, noted.`);
        }
        break;
      case "brief":
        brief.push(seg.text);
        if (seg.constraint) constraints = mergeConstraint(constraints, seg.constraint);
        break;
      case "content":
        if (seg.verbatim) {
          flushMaterial();
          actions.push({ type: "insert", text: seg.text, position: seg.position ?? "end", turnId: turn.id });
        } else material.push(seg.text);
        break;
      case "steer":
        flushMaterial();
        actions.push(
          /\b(?:write|draft|add|continue|keep going|carry on|give me|finish|wrap up|conclude|start)\b/i.test(
            seg.text,
          ) &&
            !/\b(?:rewrite|the (?:opening|intro|ending|last|first)|that (?:paragraph|sentence|bit|part))\b/i.test(
              seg.text,
            )
            ? { type: "compose", instruction: seg.text, material: [], turnId: turn.id }
            : { type: "revise", instruction: seg.text, turnId: turn.id },
        );
        break;
    }
  }
  // Plain content is dictation-with-latitude: it's drafted in, not pasted verbatim.
  flushMaterial();

  const briefNew = brief.length > state.brief.length;
  // The first brief with nothing else to do starts the draft.
  if (briefNew && !actions.length && !state.brief.length)
    actions.push({
      type: "compose",
      instruction: "Start the draft from the brief.",
      material: [],
      turnId: turn.id,
    });
  if (briefNew) replies.unshift("Got it.");

  const intents = [...new Set(segments.map((s) => s.intent))];
  const next: ConversationState = {
    brief,
    constraints,
    turns: [...state.turns, { id: turn.id, speaker: "you", text: turn.text, at: turn.at, intents }],
  };
  return { state: next, plan: { actions, reply: replies.length ? replies.join(" ") : null } };
}

/** The brief and constraints as instructions for the writing model. */
export function writerContext(state: ConversationState): string {
  const lines: string[] = [];
  if (state.brief.length) lines.push(`The piece, as the writer described it: ${state.brief.join(" ")}`);
  if (state.constraints.length) {
    lines.push("Constraints the writer set (follow all of them):");
    for (const c of state.constraints)
      lines.push(`- ${c.label}${c.kind === "other" || c.kind === "avoid" ? "" : ` (said: "${c.source}")`}`);
  }
  return lines.join("\n");
}
