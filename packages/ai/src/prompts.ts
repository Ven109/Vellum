/**
 * Prompt assembly for the writing assistant. Everything that is sent is also returned as `sources`, so
 * the UI can show exactly what the assistant was grounded in — nothing is attached silently.
 */
export interface AssistantContext {
  documentTitle: string;
  /** Selected text, if the user has a selection and chose to attach it. */
  selection?: string;
  /** Whole draft as Markdown, if attached. */
  document?: string;
  houseRules?: string;
  voiceTraits?: string[];
}

export interface PromptSource {
  kind: "selection" | "document" | "house-rules" | "voice";
  label: string;
  detail: string;
}

export interface BuiltPrompt {
  system: string;
  sources: PromptSource[];
}

const BASE = `You are the writing assistant inside Vellum, a long-form writing app. You help one writer with their own draft.
- Preserve the writer's meaning, facts and point of view. Never invent facts, quotes, names or numbers.
- Match the writer's voice. Prefer plain, specific language.
- Be concise in conversation. When asked for a rewrite, output only the rewritten text with no preamble, quotes or commentary.`;

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function buildSystemPrompt(ctx: AssistantContext): BuiltPrompt {
  const parts = [BASE];
  const sources: PromptSource[] = [];

  if (ctx.voiceTraits?.length) {
    parts.push(
      `<voice_profile>\nThe writer's voice, learned from their published work:\n${ctx.voiceTraits.map((t) => `- ${t}`).join("\n")}\n</voice_profile>`,
    );
    sources.push({ kind: "voice", label: "Voice profile", detail: `${ctx.voiceTraits.length} traits` });
  }
  const rules = houseRuleList(ctx.houseRules);
  if (rules.length) {
    parts.push(
      `<house_rules>\nWorkspace house rules. Follow them in everything you write:\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n</house_rules>\n` +
        `If following a house rule made you write something differently from how you otherwise would have, end your reply with one final line exactly like ${RULES_MARKER_EXAMPLE}, listing only those rule numbers. Leave the line out when no rule changed what you wrote.`,
    );
    sources.push({ kind: "house-rules", label: "House rules", detail: `${rules.length} rules` });
  }
  if (ctx.document !== undefined) {
    parts.push(
      `<document title="${escapeAttr(ctx.documentTitle || "Untitled")}">\n${ctx.document}\n</document>`,
    );
    sources.push({
      kind: "document",
      label: `Whole draft: ${ctx.documentTitle || "Untitled"}`,
      detail: `${words(ctx.document)} words`,
    });
  }
  if (ctx.selection) {
    parts.push(
      `<selection>\n${ctx.selection}\n</selection>\nThe writer is asking about the selected passage above.`,
    );
    sources.push({ kind: "selection", label: "Selection", detail: `${words(ctx.selection)} words` });
  }
  return { system: parts.join("\n\n"), sources };
}

const RULES_MARKER_EXAMPLE = "[rules: 1, 3]";
const RULES_MARKER = /\n*\s*\[rules:\s*([\d,\s]*)\]\s*$/i;

/** House rules as a list: one per non-empty line, list bullets removed. */
export function houseRuleList(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Split the "[rules: …]" line the model adds when a house rule changed its output from the text, and
 * return the rules it names. Numbers that don't match a rule are ignored.
 */
export function extractAppliedRules(
  text: string,
  houseRules: string | undefined,
): { text: string; applied: string[] } {
  const m = RULES_MARKER.exec(text);
  if (!m) return { text, applied: [] };
  const rules = houseRuleList(houseRules);
  const applied = [
    ...new Set(
      m[1]!
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= rules.length),
    ),
  ].map((n) => rules[n - 1]!);
  return { text: text.slice(0, m.index).trimEnd(), applied };
}

/** While streaming, hide a rules line that has started arriving but isn't finished yet. */
export function hidePartialRulesMarker(text: string): string {
  const full = RULES_MARKER.exec(text);
  if (full) return text.slice(0, full.index).trimEnd();
  const partial = /\n\s*\[(?:r(?:u(?:l(?:e(?:s(?::[\d,\s]*)?)?)?)?)?)?$/i.exec(text);
  return partial ? text.slice(0, partial.index) : text;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export interface QuickAction {
  id: string;
  label: string;
  /** Rewrite actions replace the selection via a proposed diff; ask actions answer in the thread. */
  kind: "rewrite" | "ask";
  instruction: string;
  needsSelection: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "tighten",
    label: "Tighten",
    kind: "rewrite",
    needsSelection: true,
    instruction: "Tighten this passage: cut redundancy and filler while keeping every idea.",
  },
  {
    id: "clarify",
    label: "Clarify",
    kind: "rewrite",
    needsSelection: true,
    instruction: "Make this passage clearer and easier to follow without changing what it says.",
  },
  {
    id: "warmer",
    label: "Warmer",
    kind: "rewrite",
    needsSelection: true,
    instruction: "Make the tone of this passage a little warmer and more personal.",
  },
  {
    id: "continue",
    label: "Continue",
    kind: "rewrite",
    needsSelection: true,
    instruction:
      "Keep the selected passage exactly as written and continue it with one more paragraph in the same voice.",
  },
  {
    id: "feedback",
    label: "Feedback",
    kind: "ask",
    needsSelection: false,
    instruction: "Give me three specific, honest suggestions to improve this draft. Be brief.",
  },
  {
    id: "titles",
    label: "Title ideas",
    kind: "ask",
    needsSelection: false,
    instruction: "Suggest five titles for this piece, one per line, no commentary.",
  },
];

export function rewriteUserMessage(instruction: string, selection: string): string {
  return `${instruction}\n\nRewrite only the text inside <passage> and reply with the rewritten passage alone.\n\n<passage>\n${selection}\n</passage>`;
}

/** Strip wrappers some models add around rewrites (quotes, code fences, "Here is…" lines). */
export function cleanRewrite(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, "$1").trim();
  t = t.replace(/^<passage>\s*([\s\S]*?)\s*<\/passage>$/i, "$1").trim();
  t = t.replace(/^(here(?:'s| is)[^\n]*:)\s*\n+/i, "").trim();
  if (/^["“].*["”]$/s.test(t) && !/["“”]/.test(t.slice(1, -1))) t = t.slice(1, -1);
  return t;
}
