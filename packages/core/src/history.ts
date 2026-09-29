import { diffStats, diffWords } from "./diff.js";
import type { RetentionPolicy, Version } from "./model.js";

type Prunable = Pick<Version, "id" | "createdAt" | "reason" | "name">;

const DAY = 86_400_000;

/** Named versions (and named checkpoints) are never pruned. */
export function isProtected(v: Pick<Version, "reason" | "name">): boolean {
  return !!v.name || v.reason === "named";
}

/**
 * Which versions a retention policy removes: everything is kept for `keepAllForDays`, then one version
 * per day (the last of that day) for `keepDailyForDays`, then nothing — except named versions, which are
 * always kept, and the newest version, which is kept as the baseline for future diffs.
 */
export function versionsToPrune(versions: Prunable[], policy: RetentionPolicy, now = Date.now()): string[] {
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newest = sorted[0]?.id;
  const keptDays = new Set<string>();
  const out: string[] = [];
  for (const v of sorted) {
    if (v.id === newest || isProtected(v)) continue;
    const age = (now - Date.parse(v.createdAt)) / DAY;
    if (age < policy.keepAllForDays) continue;
    if (age < policy.keepAllForDays + policy.keepDailyForDays) {
      const day = v.createdAt.slice(0, 10);
      if (!keptDays.has(day)) {
        keptDays.add(day); // sorted newest first, so this is the last version of that day
        continue;
      }
    }
    out.push(v.id);
  }
  return out;
}

/** Word-level changes between two versions (or any two texts). */
export function compareVersions(from: string, to: string) {
  const ops = diffWords(from, to);
  return { ops, ...diffStats(ops) };
}

/** Group versions by local calendar day, newest first, for a timeline. */
export function groupByDay<T extends Pick<Version, "createdAt">>(
  versions: T[],
): Array<{ day: string; versions: T[] }> {
  const groups = new Map<string, T[]>();
  for (const v of [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const d = new Date(v.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = groups.get(key) ?? [];
    list.push(v);
    groups.set(key, list);
  }
  return [...groups].map(([day, list]) => ({ day, versions: list }));
}
