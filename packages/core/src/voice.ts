import type { VoiceTrait } from "./model.js";

/**
 * Learns observable traits of a writer's voice from their published pieces. Everything is measured,
 * not guessed: each trait carries the numbers behind it, and becomes one plain-language instruction
 * injected into rewrite prompts. Drafts are never used as input.
 */
export interface VoiceStats {
  words: number;
  sentences: number;
  avgSentenceWords: number;
  sentenceWordsStdDev: number;
  shortSentenceShare: number;
  avgParagraphSentences: number;
  adverbsPer100: number;
  emDashesPer1000: number;
  semicolonsPer1000: number;
  exclamationsPer1000: number;
  questionsShare: number;
  contractionsPer100: number;
  firstPersonPer100: number;
  signatureWords: string[];
}

const COMMON = new Set(
  `the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did said very really much more many such own same too each few those am being doing does let may might must shall should got made went ever never still here where why while through during before under again further once off both between into until against among per via yet nor either neither whether upon`.split(
    /\s+/,
  ),
);

const ADVERB_EXCEPTIONS = new Set([
  "only",
  "family",
  "early",
  "daily",
  "likely",
  "reply",
  "supply",
  "apply",
  "fly",
  "july",
  "italy",
  "holy",
  "ugly",
  "silly",
  "belly",
  "rely",
  "ally",
  "bully",
  "jelly",
  "lily",
  "hilly",
  "folly",
  "rally",
  "tally",
  "wholly",
  "friendly",
  "lovely",
  "lonely",
  "lively",
  "costly",
  "elderly",
  "ugly",
  "unlikely",
  "curly",
  "chilly",
  "orderly",
  "monthly",
  "weekly",
  "yearly",
  "hourly",
]);

function sentencesOf(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])["”’)]*\s+(?=[A-Z“"‘(0-9])/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
}

const wordsOf = (text: string) => text.match(/[\p{L}][\p{L}’'-]*/gu) ?? [];

/** Strip Markdown syntax so it doesn't count as punctuation habits. */
function plain(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "");
}

export function measureVoice(markdownPieces: string[]): VoiceStats | null {
  const texts = markdownPieces.map(plain).filter((t) => t.trim());
  const all = texts.join("\n\n");
  const words = wordsOf(all);
  if (words.length < 150) return null;
  const sentences = texts.flatMap(sentencesOf);
  const lengths = sentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const variance = lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lengths.length);
  const paragraphs = texts.flatMap((t) => t.split(/\n\s*\n/)).filter((p) => /[\p{L}]/u.test(p));
  const lower = words.map((w) => w.toLowerCase());
  const adverbs = lower.filter((w) => w.length > 4 && w.endsWith("ly") && !ADVERB_EXCEPTIONS.has(w)).length;
  const count = (re: RegExp) => (all.match(re) ?? []).length;
  const per = (n: number, base: number) => (n / words.length) * base;

  const freq = new Map<string, number>();
  for (const w of lower) {
    if (w.length < 4 || COMMON.has(w) || w.endsWith("ly") || /’|'/.test(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const minHits = Math.max(3, Math.round(words.length / 1500));
  const signatureWords = [...freq.entries()]
    .filter(([, n]) => n >= minHits)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([w]) => w);

  return {
    words: words.length,
    sentences: lengths.length,
    avgSentenceWords: round(avg),
    sentenceWordsStdDev: round(Math.sqrt(variance)),
    shortSentenceShare: round(lengths.filter((n) => n <= 8).length / Math.max(1, lengths.length), 2),
    avgParagraphSentences: round(lengths.length / Math.max(1, paragraphs.length)),
    adverbsPer100: round(per(adverbs, 100)),
    emDashesPer1000: round(per(count(/—|--|\s–\s/g), 1000)),
    semicolonsPer1000: round(per(count(/;/g), 1000)),
    exclamationsPer1000: round(per(count(/!/g), 1000)),
    questionsShare: round(
      sentences.filter((s) => /\?["”’)]*$/.test(s)).length / Math.max(1, sentences.length),
      2,
    ),
    contractionsPer100: round(per(lower.filter((w) => /[’'](s|t|re|ve|ll|d|m)$/.test(w)).length, 100)),
    firstPersonPer100: round(
      per(
        lower.filter((w) => w === "i" || w === "me" || w === "my" || w === "we" || w === "our").length,
        100,
      ),
    ),
    signatureWords,
  };
}

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Turn measurements into editable traits. Ids are stable so user edits survive re-learning. */
export function traitsFromStats(s: VoiceStats): VoiceTrait[] {
  const t: VoiceTrait[] = [];
  const add = (id: string, label: string, instruction: string) =>
    t.push({ id, label, instruction, enabled: true });

  if (s.avgSentenceWords <= 14)
    add(
      "sentence-length",
      "Short sentences",
      `Keep sentences short: this writer averages ${s.avgSentenceWords} words per sentence.`,
    );
  else if (s.avgSentenceWords >= 24)
    add(
      "sentence-length",
      "Long, flowing sentences",
      `Longer sentences are fine: this writer averages ${s.avgSentenceWords} words per sentence.`,
    );
  else
    add(
      "sentence-length",
      "Medium sentences",
      `Aim for about ${s.avgSentenceWords} words per sentence on average.`,
    );

  if (s.sentenceWordsStdDev >= 9 && s.shortSentenceShare >= 0.15)
    add(
      "rhythm",
      "Varied rhythm",
      `Vary sentence length; mix long sentences with short punchy ones (about ${Math.round(s.shortSentenceShare * 100)}% are 8 words or fewer).`,
    );
  else if (s.sentenceWordsStdDev < 5)
    add("rhythm", "Even rhythm", "Keep sentence lengths fairly even; avoid abrupt fragments.");

  if (s.adverbsPer100 < 0.8)
    add(
      "adverbs",
      "Few adverbs",
      `Use adverbs sparingly (about ${s.adverbsPer100} per 100 words); prefer strong verbs.`,
    );
  else if (s.adverbsPer100 > 2.5)
    add(
      "adverbs",
      "Adverb-friendly",
      `Adverbs are part of this voice (about ${s.adverbsPer100} per 100 words).`,
    );

  if (s.emDashesPer1000 >= 3)
    add(
      "dashes",
      "Uses em dashes",
      `Em dashes are a habit (about ${s.emDashesPer1000} per 1,000 words) — use them for asides.`,
    );
  else if (s.emDashesPer1000 < 0.5)
    add("dashes", "No em dashes", "Avoid em dashes; use commas or full stops instead.");
  if (s.semicolonsPer1000 >= 2)
    add("semicolons", "Uses semicolons", "Semicolons are welcome between closely linked clauses.");
  else if (s.semicolonsPer1000 < 0.3) add("semicolons", "No semicolons", "Avoid semicolons.");
  if (s.exclamationsPer1000 < 0.3)
    add("exclamations", "No exclamation marks", "Never use exclamation marks.");
  if (s.questionsShare >= 0.08)
    add(
      "questions",
      "Asks the reader questions",
      "Rhetorical questions to the reader are part of this voice; use them occasionally.",
    );

  if (s.contractionsPer100 >= 1.2)
    add("contractions", "Conversational", "Use contractions (it's, don't) for a conversational tone.");
  else if (s.contractionsPer100 < 0.3)
    add("contractions", "Formal register", "Avoid contractions; write it is, do not.");
  if (s.firstPersonPer100 >= 2) add("person", "First person", "Write in the first person where natural.");

  if (s.avgParagraphSentences <= 2.5)
    add(
      "paragraphs",
      "Short paragraphs",
      `Keep paragraphs short (about ${s.avgParagraphSentences} sentences).`,
    );
  if (s.signatureWords.length >= 3)
    add(
      "vocabulary",
      "Recurring vocabulary",
      `Favoured words include: ${s.signatureWords.join(", ")}. Reuse them where they fit; don't force them.`,
    );
  return t;
}

/**
 * Re-learn while keeping the writer's edits: a trait the writer edited or switched off keeps their
 * version; traits they deleted stay deleted (listed in `deleted`).
 */
export function mergeTraits(
  learned: VoiceTrait[],
  existing: VoiceTrait[],
  edited: Set<string>,
  deleted: Set<string>,
): VoiceTrait[] {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const out: VoiceTrait[] = [];
  for (const t of learned) {
    if (deleted.has(t.id)) continue;
    const prev = byId.get(t.id);
    if (prev && (edited.has(t.id) || !prev.enabled)) out.push(prev);
    else out.push(t);
  }
  // Keep writer-created traits that the analysis doesn't produce.
  for (const t of existing) if (t.id.startsWith("custom-") && !out.some((o) => o.id === t.id)) out.push(t);
  return out;
}
