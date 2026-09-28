/**
 * Fast fuzzy matching for the command palette. A query matches when its characters appear in order in
 * the target. Scores reward matches at word starts, consecutive runs and early positions, so "wtnt"
 * ranks "Why the tool nobody talks" highly. Returns null when there is no match.
 */
export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the target, for highlighting. */
  indices: number[];
}

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  const cur = text[i]!;
  return /[\s\-_/.:]/.test(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = target.toLowerCase();

  // Fast path: contiguous substring gets a strong score.
  const at = t.indexOf(q);
  if (at !== -1) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k);
    const score =
      1000 + (isBoundary(target, at) ? 200 : 0) - at + (at === 0 ? 300 : 0) - (t.length - q.length) * 0.5;
    return { score, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    if (ch === " ") continue;
    // Prefer the next word-boundary occurrence if one exists before a plain one would force a worse path.
    let found = -1;
    let boundaryFound = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== ch) continue;
      if (found === -1) found = j;
      if (isBoundary(target, j)) {
        boundaryFound = j;
        break;
      }
      if (j === prevMatch + 1) break; // consecutive beats a later boundary
    }
    const pick = found === prevMatch + 1 ? found : boundaryFound !== -1 ? boundaryFound : found;
    if (pick === -1) return null;
    score += 10;
    if (pick === prevMatch + 1) score += 15;
    if (isBoundary(target, pick)) score += 20;
    score -= Math.min(pick - ti, 10);
    indices.push(pick);
    prevMatch = pick;
    ti = pick + 1;
  }
  score -= (t.length - indices.length) * 0.1;
  return { score, indices };
}

export interface Ranked<T> {
  item: T;
  match: FuzzyMatch;
}

/** Rank items by the best match across their searchable strings, keeping at most `limit`. */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  keys: (item: T) => string[],
  limit = 50,
): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    let best: FuzzyMatch | null = null;
    const fields = keys(item);
    for (let k = 0; k < fields.length; k++) {
      const m = fuzzyMatch(query, fields[k]!);
      // Secondary fields (e.g. collection name) count for less than the title.
      if (m && k > 0) m.score -= 50;
      if (m && k > 0) m.indices = [];
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best) out.push({ item, match: best });
  }
  out.sort((a, b) => b.match.score - a.match.score);
  return out.slice(0, limit);
}
