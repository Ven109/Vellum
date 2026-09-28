/**
 * Cheap text statistics. Word counting uses Unicode word segmentation when available so it behaves for
 * non-Latin scripts, and a whitespace split otherwise.
 */
const segmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

export function countWords(text: string): number {
  if (!text.trim()) return 0;
  if (segmenter) {
    let n = 0;
    for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.trim().split(/\s+/).length;
}

/** Average adult silent-reading speed for non-fiction prose (Brysbaert, 2019). */
export const READING_WPM = 238;

export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  /** Estimated reading time in whole minutes (minimum 1 for any non-empty text). */
  readingMinutes: number;
}

export function documentStats(text: string): DocumentStats {
  const words = countWords(text);
  let charactersNoSpaces = 0;
  let characters = 0;
  for (const ch of text) {
    if (ch === "\n") continue;
    characters++;
    if (!/\s/.test(ch)) charactersNoSpaces++;
  }
  return {
    words,
    characters,
    charactersNoSpaces,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / READING_WPM)),
  };
}

export function formatReadingTime(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 60) return `${minutes} min read`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min read` : `${h} h read`;
}
