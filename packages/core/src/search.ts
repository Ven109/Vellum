/**
 * A small inverted index for full-text search over titles and bodies. Pure data, serialisable to JSON,
 * so the same index runs in the browser (persisted in IndexedDB), in the offline desktop build and on
 * the server. Supports prefix matching on the last query term ("search as you type") and returns
 * snippets around the first hit.
 */
export interface SearchDoc {
  id: string;
  title: string;
  body: string;
}

export interface SearchHit {
  id: string;
  score: number;
  snippet: string;
  /** Terms that matched, for highlighting. */
  terms: string[];
}

interface Posting {
  /** term frequency in body */
  tf: number;
  /** term appears in title */
  title: boolean;
}

export interface SerializedIndex {
  v: 1;
  docs: Record<string, { title: string; body: string; len: number }>;
}

const STOP = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "to",
  "in",
  "is",
  "it",
  "on",
  "for",
  "or",
  "at",
  "by",
  "be",
]);

export function normalise(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalise(text).match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
}

export class SearchIndex {
  private readonly postings = new Map<string, Map<string, Posting>>();
  private readonly docs = new Map<string, { title: string; body: string; len: number }>();
  private sortedTerms: string[] | null = null;

  get size(): number {
    return this.docs.size;
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  get(id: string): SearchDoc | undefined {
    const d = this.docs.get(id);
    return d ? { id, title: d.title, body: d.body } : undefined;
  }

  upsert(doc: SearchDoc): void {
    this.remove(doc.id);
    const bodyTokens = tokenize(doc.body);
    const titleTokens = new Set(tokenize(doc.title));
    this.docs.set(doc.id, { title: doc.title, body: doc.body, len: bodyTokens.length + titleTokens.size });
    const counts = new Map<string, number>();
    for (const t of bodyTokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of titleTokens) if (!counts.has(t)) counts.set(t, 0);
    for (const [term, tf] of counts) {
      let p = this.postings.get(term);
      if (!p) this.postings.set(term, (p = new Map()));
      p.set(doc.id, { tf, title: titleTokens.has(term) });
    }
    this.sortedTerms = null;
  }

  remove(id: string): void {
    const existing = this.docs.get(id);
    if (!existing) return;
    for (const term of new Set([...tokenize(existing.title), ...tokenize(existing.body)])) {
      const p = this.postings.get(term);
      p?.delete(id);
      if (p && p.size === 0) this.postings.delete(term);
    }
    this.docs.delete(id);
    this.sortedTerms = null;
  }

  private expand(prefix: string): string[] {
    this.sortedTerms ??= [...this.postings.keys()].sort();
    const terms = this.sortedTerms;
    let lo = 0;
    let hi = terms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (terms[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < terms.length && terms[i]!.startsWith(prefix) && out.length < 50; i++)
      out.push(terms[i]!);
    return out;
  }

  search(query: string, limit = 20): SearchHit[] {
    const raw = tokenize(query);
    if (!raw.length) return [];
    const endsWithSpace = /\s$/.test(query);
    const terms = raw.filter((t, i) => !STOP.has(t) || raw.length === 1 || i === raw.length - 1);
    const N = Math.max(1, this.docs.size);
    let candidates: Map<string, { score: number; terms: Set<string> }> | null = null;

    terms.forEach((term, i) => {
      const isLast = i === terms.length - 1;
      const variants = isLast && !endsWithSpace ? this.expand(term) : this.postings.has(term) ? [term] : [];
      const scores = new Map<string, { score: number; terms: Set<string> }>();
      for (const v of variants) {
        const p = this.postings.get(v)!;
        const idf = Math.log(1 + N / p.size);
        const exact = v === term ? 1 : 0.7;
        for (const [id, post] of p) {
          const len = this.docs.get(id)!.len || 1;
          const s =
            ((post.tf * 1.2) / (post.tf + 1.2 * (0.25 + (0.75 * len) / 300)) + (post.title ? 3 : 0)) *
            idf *
            exact;
          const cur = scores.get(id);
          if (cur) {
            cur.score = Math.max(cur.score, s);
            cur.terms.add(v);
          } else scores.set(id, { score: s, terms: new Set([v]) });
        }
      }
      // All terms must match (AND semantics).
      if (!candidates) candidates = scores;
      else {
        const next = new Map<string, { score: number; terms: Set<string> }>();
        for (const [id, c] of candidates) {
          const s = scores.get(id);
          if (s) next.set(id, { score: c.score + s.score, terms: new Set([...c.terms, ...s.terms]) });
        }
        candidates = next;
      }
    });

    const results = [
      ...((candidates as Map<string, { score: number; terms: Set<string> }> | null) ??
        new Map<string, { score: number; terms: Set<string> }>()),
    ]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);
    return results.map(([id, c]) => ({
      id,
      score: c.score,
      terms: [...c.terms],
      snippet: snippet(this.docs.get(id)!.body, [...c.terms]),
    }));
  }

  toJSON(): SerializedIndex {
    return { v: 1, docs: Object.fromEntries(this.docs) };
  }

  static fromJSON(data: SerializedIndex): SearchIndex {
    const index = new SearchIndex();
    for (const [id, d] of Object.entries(data.docs)) index.upsert({ id, title: d.title, body: d.body });
    return index;
  }
}

/** A ~160 character excerpt centred on the first matching term. */
export function snippet(body: string, terms: string[], width = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = normalise(flat);
  let at = -1;
  for (const t of terms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
    const m = re.exec(lower);
    if (m && (at === -1 || m.index < at)) at = m.index + m[1]!.length;
  }
  if (at === -1) return flat.slice(0, width) + (flat.length > width ? "…" : "");
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}
