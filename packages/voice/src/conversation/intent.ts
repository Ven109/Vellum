import { NUMBER_PATTERN, parseNumber } from "./numbers.js";

/**
 * What a piece of speech is for:
 * - content: words to put in the document ("Every workshop has one tool nobody talks about.")
 * - constraint: a rule about the writing ("Keep it under 800 words.")
 * - steer: an instruction to change or produce text ("Make the opening punchier.")
 * - brief: what the piece is and who it's for ("It's an essay for people starting woodworking.")
 * - thinking: thinking aloud, not meant for the page ("Hmm, where was I.")
 */
export type Intent = "content" | "constraint" | "steer" | "brief" | "thinking";

export type ConstraintKind =
  "length" | "tone" | "audience" | "format" | "person" | "title" | "avoid" | "other";

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  /** How it reads on a chip: "Under 800 words", "Tone: warm". */
  label: string;
  /** What was said. */
  source: string;
  /** Length limits, in words. */
  maxWords?: number;
  minWords?: number;
  targetWords?: number;
  value?: string;
}

export interface Segment {
  intent: Intent;
  text: string;
  constraint?: Omit<Constraint, "id">;
  /** Content said as a quotation ("write: …", "quote …"): used word for word. */
  verbatim?: boolean;
  /** Where content should go, when said ("start with …", "end on …"). */
  position?: "start" | "end";
}

const FILLER =
  /^(?:u+h+m*|u+m+|h+m+|e+r+m*|a+h+|o+h+|well|so|okay|ok|right|yeah|like|you know|i mean|let me think|let's see|hang on|wait|hmm+)[\s,.!?…-]*$/i;
const THINKING = [
  /^(?:u+h+m*|u+m+|h+m+|e+r+m*)\b/i,
  /\b(?:let me think|let's see|where was i|what else|i'm not sure|i don't know(?: yet)?|hang on|give me a (?:second|sec|moment)|thinking out loud|never ?mind)\b/i,
  /^(?:what (?:should|could|would) (?:i|we)\b)/i,
  /^(?:maybe|perhaps)\b.*\?$/i,
];

const BRIEF = [
  /^(?:i(?:'m| am) (?:writing|working on|trying to write)|i want (?:to write|a piece)|i'd like (?:to write|a piece)|this (?:is|will be|should be) (?:a|an|my) (?:essay|piece|post|article|story|newsletter|letter|talk|chapter|review|report|guide|column|memo|speech)|the (?:piece|essay|post|article|story|newsletter|draft) is (?:about|for|on)|it's (?:a|an) (?:essay|piece|post|article|story|newsletter|guide|review) (?:about|on|for)|(?:the )?topic is|we're writing|let's write (?:a|an))/i,
];

const STEER = [
  /^(?:please\s+)?(?:make|change|rewrite|rephrase|reword|tighten|shorten|lengthen|expand|trim|cut|delete|remove|drop|move|swap|replace|fix|polish|simplify|clarify|soften|strengthen|punch up|tone down|merge|split|reorder|turn|go back|undo|scratch|redo|try again|continue|keep going|carry on|write|draft|add|give me|finish|wrap up|conclude|start over|summari[sz]e|explain|elaborate)\b/i,
  /^(?:can|could|would) you\b/i,
  /^(?:scratch|strike|lose|kill) that\b/i,
  /^(?:actually,?\s+)?(?:no|not that),?\s/i,
  /\b(?:the (?:opening|intro|introduction|ending|conclusion|last (?:paragraph|sentence|line)|first (?:paragraph|sentence|line)|title|headline|second paragraph|third paragraph)|that (?:paragraph|sentence|line|bit|part|section))\b.*\b(?:should|needs to|is too|isn't|feels)\b/i,
];

function id() {
  return `con_${Math.random().toString(36).slice(2, 10)}`;
}

const TONES =
  "formal|informal|casual|friendly|warm|serious|playful|funny|witty|dry|punchy|academic|conversational|professional|personal|urgent|calm|confident|gentle|blunt|lyrical|plain|simple";

/** A rule about the writing, if `text` states one. */
export function parseConstraint(text: string): Omit<Constraint, "id"> | null {
  const t = text.trim().replace(/[.!]+$/, "");
  const lower = t.toLowerCase();
  const num = `(${NUMBER_PATTERN})`;
  const words = "\\s*(?:words?|word count)";

  let m = new RegExp(
    `\\b(?:under|below|less than|fewer than|no more than|at most|max(?:imum)?(?: of)?|shorter than|not more than|keep it to|cap it at|within)\\s+${num}${words}`,
    "i",
  ).exec(lower);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n) return { kind: "length", label: `Under ${n.toLocaleString("en")} words`, source: t, maxWords: n };
  }
  m = new RegExp(
    `\\b(?:at least|more than|over|no (?:fewer|less) than|minimum(?: of)?)\\s+${num}${words}`,
    "i",
  ).exec(lower);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n)
      return { kind: "length", label: `At least ${n.toLocaleString("en")} words`, source: t, minWords: n };
  }
  m = new RegExp(
    `\\b(?:about|around|roughly|approximately|aim for|target(?: of)?|make it|should be|it's|keep it(?: at)?)\\s+${num}${words}`,
    "i",
  ).exec(lower);
  if (m) {
    const n = parseNumber(m[1]!);
    if (n)
      return { kind: "length", label: `About ${n.toLocaleString("en")} words`, source: t, targetWords: n };
  }
  m = new RegExp(
    `\\b(?:keep it|make it|it should be|write it|sound|should sound|in a|tone(?: should be| is)?:?)\\s+(?:more\\s+|less\\s+|a bit\\s+|quite\\s+|very\\s+)?(${TONES})(?:\\s+tone)?\\b`,
    "i",
  ).exec(lower);
  if (m && !/\b(?:the (?:opening|intro|ending|conclusion|title|paragraph|sentence))\b/i.test(lower))
    return { kind: "tone", label: `Tone: ${m[1]}`, source: t, value: m[1]! };
  m =
    /\b(?:for|aimed at|written for|audience is|readers are|reader is|pitched at)\s+((?:people|readers|beginners|experts|kids|children|students|developers|engineers|managers|parents|teachers|writers|designers|a general audience|non-?technical \w+|\w+ who [\w\s']+|\w+ readers)[\w\s'-]*)$/i.exec(
      t,
    );
  if (
    m &&
    /^(?:it's|this is|the piece is|write|keep|make|aim|pitch|the audience|my readers|our readers|readers)/i.test(
      t,
    )
  )
    return { kind: "audience", label: `For ${m[1]!.trim()}`, source: t, value: m[1]!.trim() };
  m = /\b(?:in (?:the )?(first|second|third) person)\b/i.exec(lower);
  if (m)
    return {
      kind: "person",
      label: `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} person`,
      source: t,
      value: m[1]!,
    };
  if (/\b(?:use|add|with|include)\s+(?:sub)?headings\b/i.test(lower))
    return { kind: "format", label: "Use headings", source: t, value: "headings" };
  if (/\b(?:no|without|don't use|skip the)\s+(?:sub)?headings\b/i.test(lower))
    return { kind: "format", label: "No headings", source: t, value: "no-headings" };
  if (/\b(?:as a|in a|use a)\s+(?:bulleted |numbered )?list\b/i.test(lower))
    return { kind: "format", label: "As a list", source: t, value: "list" };
  if (/\b(?:short|shorter)\s+paragraphs\b/i.test(lower))
    return { kind: "format", label: "Short paragraphs", source: t, value: "short-paragraphs" };
  m = /\b(?:call it|title it|the title is|title should be|name it|headline it)\s+["“']?(.+?)["”']?$/i.exec(t);
  if (m) return { kind: "title", label: `Title: ${m[1]}`, source: t, value: m[1]! };
  m =
    /^(?:please\s+)?(?:don't|do not|never|avoid|no more|stop)\s+(?:use|using|say|saying|mention|mentioning)?\s*(.+)$/i.exec(
      t,
    );
  if (m && !/\b(?:that|this) (?:paragraph|sentence|bit)\b/i.test(lower))
    return { kind: "avoid", label: `Avoid ${m[1]}`, source: t, value: m[1]! };
  if (
    /^(?:always|make sure (?:you|to|it)|remember to|every paragraph should|the whole (?:thing|piece) should)\b/i.test(
      lower,
    )
  )
    return { kind: "other", label: t.length > 40 ? `${t.slice(0, 38)}…` : t, source: t, value: t };
  return null;
}

/** Split speech into sentences, keeping "start with: …" style lead-ins with what follows. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[A-Z"“‘'0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const VERBATIM =
  /^(?:(?:write|put|type|add|say|quote|start with|begin with|open with|end with|finish with|close with|end on|the first line is|the opening line is)(?: this| down| in| the line| the sentence)?\s*[:,-]\s*|quote[,:]?\s+)(.+?)(?:[,\s]*(?:end ?quote|unquote)[.!?]*)?$/i;

function classifySentence(s: string): Segment {
  const verbatim = VERBATIM.exec(s);
  if (verbatim) {
    const lead = s.slice(0, s.length - verbatim[1]!.length).toLowerCase();
    const position = /start|begin|open|first|opening/.test(lead)
      ? "start"
      : /end|finish|close/.test(lead)
        ? "end"
        : undefined;
    const text = verbatim[1]!.replace(/^["“'‘]|["”'’]$/g, "").trim();
    return { intent: "content", text, verbatim: true, ...(position ? { position } : {}) };
  }
  if (FILLER.test(s) || THINKING.some((r) => r.test(s))) return { intent: "thinking", text: s };
  if (BRIEF.some((r) => r.test(s))) {
    // "It's a piece for people just starting out" describes the piece and sets its audience.
    const audience = parseConstraint(s);
    return { intent: "brief", text: s, ...(audience?.kind === "audience" ? { constraint: audience } : {}) };
  }
  const constraint = parseConstraint(s);
  if (constraint) return { intent: "constraint", text: s, constraint };
  if (STEER.some((r) => r.test(s))) return { intent: "steer", text: s };
  // Questions to the agent are steering ("what if we open with the story?"); anything else is content.
  if (/\?$/.test(s)) return { intent: "steer", text: s };
  return { intent: "content", text: s };
}

/**
 * The fast, offline classifier: rules over each sentence. Used on its own without an AI provider, and as
 * the fallback when the model is slow or unsure.
 */
export function classifyTurn(text: string): Segment[] {
  const out: Segment[] = [];
  for (const s of sentences(text)) {
    const seg = classifySentence(s);
    const prev = out.at(-1);
    // Consecutive plain content (or thinking) reads as one passage.
    if (
      prev &&
      prev.intent === seg.intent &&
      (seg.intent === "content" || seg.intent === "thinking") &&
      !prev.verbatim &&
      !seg.verbatim
    )
      prev.text = `${prev.text} ${seg.text}`;
    else out.push(seg);
  }
  return out;
}

export const newConstraintId = id;
