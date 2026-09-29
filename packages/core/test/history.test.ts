import { describe, expect, it } from "vitest";
import { compareVersions, groupByDay, versionsToPrune } from "../src/history.js";

const policy = { keepAllForDays: 7, keepDailyForDays: 30, keepNamed: true as const };
const now = Date.parse("2026-03-31T12:00:00Z");
const at = (daysAgo: number, hour = 12) =>
  new Date(now - daysAgo * 86_400_000 + (hour - 12) * 3_600_000).toISOString();
const v = (id: string, createdAt: string, extra: { name?: string; reason?: "named" | "autosave" } = {}) => ({
  id,
  createdAt,
  reason: extra.reason ?? ("autosave" as const),
  ...(extra.name ? { name: extra.name } : {}),
});

describe("retention", () => {
  it("keeps everything recent, the last per day for a while, then drops the rest", () => {
    const versions = [
      v("new", at(0)),
      v("recent", at(3)),
      v("d10-early", at(10, 9)),
      v("d10-late", at(10, 18)),
      v("d20", at(20)),
      v("old", at(60)),
      v("old-named", at(90), { name: "First draft" }),
      v("old-checkpoint", at(120), { reason: "named" }),
    ];
    expect(versionsToPrune(versions, policy, now).sort()).toEqual(["d10-early", "old"]);
  });

  it("never prunes the newest version", () => {
    expect(versionsToPrune([v("only", at(400))], policy, now)).toEqual([]);
  });
});

describe("history helpers", () => {
  it("compares versions word by word", () => {
    const r = compareVersions("the quick fox", "the slow brown fox");
    expect(r.added).toBe(2);
    expect(r.removed).toBe(1);
  });

  it("groups by day, newest first", () => {
    const g = groupByDay([
      { createdAt: "2026-03-01T10:00:00" },
      { createdAt: "2026-03-02T09:00:00" },
      { createdAt: "2026-03-02T11:00:00" },
    ]);
    expect(g.map((x) => [x.day, x.versions.length])).toEqual([
      ["2026-03-02", 2],
      ["2026-03-01", 1],
    ]);
    expect(g[0]!.versions[0]!.createdAt).toBe("2026-03-02T11:00:00");
  });
});
