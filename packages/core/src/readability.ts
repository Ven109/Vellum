import { countWords } from "./stats.js";

/** Rough English syllable count: vowel groups, minus a silent final "e", at least one. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch reading ease: higher is easier (60–70 is plain English). */
  ease: number;
  /** Flesch–Kincaid grade level: the US school grade that can follow the text. */
  grade: number;
  label: string;
}

export function readability(text: string): Readability | null {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (words.length < 30) return null; // too little text for a meaningful score
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const wps = words.length / sentences;
  const spw = syl / words.length;
  const ease = Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10;
  const grade = Math.max(0, Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10);
  return { words: countWords(text), sentences, ease, grade, label: easeLabel(ease) };
}

export function easeLabel(ease: number): string {
  if (ease >= 80) return "Very easy";
  if (ease >= 70) return "Easy";
  if (ease >= 60) return "Plain English";
  if (ease >= 50) return "Fairly difficult";
  if (ease >= 30) return "Difficult";
  return "Very difficult";
}
