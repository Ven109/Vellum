/**
 * What background sync needs to know without opening documents: which have local edits the server
 * hasn't confirmed ("dirty"), and which server version of each document this device last synced.
 */
const DIRTY_KEY = "vellum:dirty-docs";
const VERSIONS_KEY = "vellum:synced-versions";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or disabled */
  }
}

let dirty: Set<string> | null = null;
const dirtySet = () => (dirty ??= new Set(read<string[]>(DIRTY_KEY, [])));

export function markDirty(docId: string) {
  const set = dirtySet();
  if (set.has(docId)) return;
  set.add(docId);
  write(DIRTY_KEY, [...set]);
}

export function clearDirty(docId: string) {
  const set = dirtySet();
  if (!set.delete(docId)) return;
  write(DIRTY_KEY, [...set]);
}

export const dirtyDocs = (): string[] => [...dirtySet()];

export function syncedVersion(docId: string): number | undefined {
  return read<Record<string, number>>(VERSIONS_KEY, {})[docId];
}

export function setSyncedVersion(docId: string, version: number) {
  const all = read<Record<string, number>>(VERSIONS_KEY, {});
  if (all[docId] === version) return;
  all[docId] = version;
  write(VERSIONS_KEY, all);
}

/**
 * Keep a full, current copy of every document on this device. On by default in the desktop app (it's
 * offline-first); in a browser documents load when opened, and only unsent edits are synced in the
 * background.
 */
export function keepEverythingOffline(): boolean {
  if (typeof window !== "undefined" && window.vellumDesktop) return true;
  return read<boolean>("vellum:offline-all", false);
}
