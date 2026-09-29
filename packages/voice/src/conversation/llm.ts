import { classifyTurn, parseConstraint } from "./intent.js";
import type { Intent, Segment } from "./intent.js";
import type { ConversationState } from "./state.js";

/** A streaming chat completion (wired to the writer's own AI provider by the app). */
export type Llm = (request: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  signal: AbortSignal;
}) => AsyncIterable<string>;

const INTENTS: Intent[] = ["content", "constraint", "steer", "brief", "thinking"];

export const CLASSIFY_SYSTEM = `You sort what a writer says aloud while dictating a piece with an AI co-writer.

Split the utterance into segments and label each one:
- "content": words meant for the document itself (a sentence, a point, an example to use). Keep their wording.
- "constraint": a rule about the whole piece — length, tone, audience, person, format, title, things to avoid.
- "steer": an instruction to write, change, move or remove text ("make the opening punchier", "add a paragraph about pricing").
- "brief": describing what the piece is, what it's about or who it's for.
- "thinking": thinking aloud, filler, or talk not meant for the page.

The crucial distinction: "Every workshop has one tool nobody talks about" is content (a sentence to use).
"Keep it under 800 words" is a constraint (an instruction about the writing), never content.

Reply with JSON only, no prose:
{"segments":[{"intent":"content|constraint|steer|brief|thinking","text":"...","verbatim":false,"position":null}]}
Set "verbatim": true only when the writer dictates exact words to use ("write: ...", "start with: ...").
Set "position" to "start" or "end" when they say where exact words go, else null.`;

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Validate the model's segments; constraints are parsed locally so chips stay consistent. */
export function segmentsFromModel(raw: unknown, utterance: string): Segment[] | null {
  const list = (raw as { segments?: unknown })?.segments;
  if (!Array.isArray(list) || !list.length) return null;
  const out: Segment[] = [];
  for (const item of list) {
    const intent = (item as { intent?: string })?.intent as Intent;
    const text = String((item as { text?: unknown })?.text ?? "").trim();
    if (!INTENTS.includes(intent) || !text) continue;
    const seg: Segment = { intent, text };
    if ((item as { verbatim?: unknown }).verbatim === true) seg.verbatim = true;
    const pos = (item as { position?: unknown }).position;
    if (pos === "start" || pos === "end") seg.position = pos;
    if (intent === "constraint") {
      const c = parseConstraint(text) ?? parseConstraint(utterance);
      seg.constraint = c ?? {
        kind: "other",
        label: text.length > 40 ? `${text.slice(0, 38)}…` : text,
        source: text,
        value: text,
      };
    }
    out.push(seg);
  }
  return out.length ? out : null;
}

export interface ClassifyOptions {
  llm?: Llm;
  /** Give up on the model after this long and use the rules (it has to keep up with speech). */
  timeoutMs?: number;
  state?: ConversationState;
}

/**
 * Classify a turn with the writer's model when there is one, falling back to the rules when there isn't,
 * when it's slow, or when its answer doesn't parse.
 */
export async function classify(
  utterance: string,
  options: ClassifyOptions = {},
): Promise<{ segments: Segment[]; by: "model" | "rules" }> {
  const rules = () => ({ segments: classifyTurn(utterance), by: "rules" as const });
  if (!options.llm || !utterance.trim()) return rules();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  try {
    const recent = options.state?.turns
      .slice(-4)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
    let text = "";
    for await (const chunk of options.llm({
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${recent ? `Recent conversation:\n${recent}\n\n` : ""}Utterance:\n${utterance}`,
        },
      ],
      maxTokens: 600,
      signal: controller.signal,
    }))
      text += chunk;
    return {
      segments: segmentsFromModel(extractJson(text), utterance) ?? classifyTurn(utterance),
      by: "model",
    };
  } catch {
    return rules();
  } finally {
    clearTimeout(timer);
  }
}
