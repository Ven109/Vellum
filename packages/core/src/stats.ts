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
