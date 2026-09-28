/**
 * Word-level diff. Text is split into tokens that keep their trailing whitespace, so joining the tokens
 * of each side reproduces the input exactly. Used for rewrite proposals and version history.
 */
export type DiffOp = { type: "equal" | "insert" | "delete"; text: string };

export function tokenizeForDiff(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}’']+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/**
 * Myers-style O(ND) diff over tokens with common prefix/suffix trimming. Falls back to a single
 * replace for very large, very different inputs to keep worst-case cost bounded.
 */
export function diffWords(a: string, b: string, maxCost = 20_000): DiffOp[] {
  const A = tokenizeForDiff(a);
  const B = tokenizeForDiff(b);
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  if (start > 0) ops.push({ type: "equal", text: A.slice(0, start).join("") });
  ops.push(...myers(A.slice(start, endA), B.slice(start, endB), maxCost));
  if (endA < A.length) ops.push({ type: "equal", text: A.slice(endA).join("") });
  return merge(ops);
}

function myers(A: string[], B: string[], maxCost: number): DiffOp[] {
  const n = A.length;
  const m = B.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: "insert", text: B.join("") }];
  if (m === 0) return [{ type: "delete", text: A.join("") }];
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  for (let d = 0; d <= max; d++) {
    if (d > 0 && d * (n + m) > maxCost * 50) {
      return [
        { type: "delete", text: A.join("") },
        { type: "insert", text: B.join("") },
      ];
    }
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) x = v.get(k + 1) ?? 0;
      else x = (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, A, B, d);
    }
  }
  return [];
}

function backtrack(trace: Array<Map<number, number>>, A: string[], B: string[], dEnd: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = A.length;
  let y = B.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", text: A[x - 1]! });
      x--;
      y--;
    }
    if (x === prevX) ops.push({ type: "insert", text: B[y - 1]! });
    else ops.push({ type: "delete", text: A[x - 1]! });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ type: "equal", text: A[x - 1]! });
    x--;
    y--;
  }
  return ops.reverse();
}

function merge(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    if (!op.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}

const wordCount = (s: string) => (s.match(/[\p{L}\p{N}’']+/gu) ?? []).length;

/** Words added and removed by a diff. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "insert") added += wordCount(op.text);
    else if (op.type === "delete") removed += wordCount(op.text);
  }
  return { added, removed };
}
