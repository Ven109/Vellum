import type { TextAnchor } from "./model.js";

/**
 * Text-side anchoring helpers. Live anchors are CRDT relative positions (they survive edits around
 * them); these helpers handle the fallback: capturing enough context to find the passage again if it
 * moves, and deciding when it is truly gone (orphaned).
 */
export const CONTEXT_CHARS = 32;

export function captureContext(
  text: string,
  start: number,
  end: number,
): Pick<TextAnchor, "quote" | "prefix" | "suffix"> {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Find the anchored passage in `text` by its quote, preferring the occurrence whose surrounding text
 * best matches the captured prefix/suffix. Returns character offsets, or null when the quote no
 * longer exists (the anchor is orphaned).
 */
export function reanchor(
  text: string,
  anchor: Pick<TextAnchor, "quote" | "prefix" | "suffix">,
): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  let best: { start: number; score: number } | null = null;
  let at = text.indexOf(anchor.quote);
  while (at !== -1) {
    const score =
      commonSuffixLength(text.slice(Math.max(0, at - CONTEXT_CHARS), at), anchor.prefix) +
      commonPrefixLength(
        text.slice(at + anchor.quote.length, at + anchor.quote.length + CONTEXT_CHARS),
        anchor.suffix,
      );
    if (!best || score > best.score) best = { start: at, score };
    at = text.indexOf(anchor.quote, at + 1);
  }
  return best ? { start: best.start, end: best.start + anchor.quote.length } : null;
}

/** Extract @mentions that match known people. Matches the longest name first ("@Ann Lee" before "@Ann"). */
export function parseMentions(body: string, people: Array<{ id: string; name: string }>): string[] {
  const found = new Set<string>();
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLowerCase();
  let i = lower.indexOf("@");
  while (i !== -1) {
    const rest = lower.slice(i + 1);
    const hit = sorted.find(
      (p) => rest.startsWith(p.name.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest.charAt(p.name.length)),
    );
    if (hit) found.add(hit.id);
    i = lower.indexOf("@", i + 1);
  }
  return [...found];
}
