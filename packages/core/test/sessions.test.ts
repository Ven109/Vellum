import { describe, expect, it } from "vitest";
import { addDays, currentStreak, dailyTotals, longestStreak, wordsOn } from "../src/sessions.js";
import type { WritingSession } from "../src/sessions.js";

const session = (endedAt: string, wordsAdded: number, activeMs = 60_000): WritingSession => ({
  id: `s${endedAt}`,
  userId: "u",
  documentId: "d",
  collectionId: null,
  startedAt: endedAt,
  endedAt,
  wordsAdded,
  wordsRemoved: 0,
  activeMs,
});

describe("daily totals", () => {
  it("adds up sessions by local day and fills gaps", () => {
    const s = [
      session("2026-03-01T09:00:00", 200),
      session("2026-03-01T21:00:00", 150),
      session("2026-03-03T10:00:00", 50),
    ];
    expect(dailyTotals(s, "2026-03-01", "2026-03-03").map((d) => [d.day, d.words, d.sessions])).toEqual([
      ["2026-03-01", 350, 2],
      ["2026-03-02", 0, 0],
      ["2026-03-03", 50, 1],
    ]);
    expect(wordsOn(s, "2026-03-01")).toBe(350);
  });
});

describe("streaks", () => {
  const today = "2026-03-20";
  const streakWith = (met: string[]) => currentStreak((d) => (met.includes(d) ? 600 : 0), 500, today);
  const back = (n: number) => addDays(today, -n);

  it("counts consecutive days, and today in progress doesn't break it", () => {
    expect(streakWith([back(1), back(2), back(3)])).toMatchObject({ days: 3, metToday: false });
    expect(streakWith([today, back(1), back(2)])).toMatchObject({ days: 3, metToday: true });
  });

  it("forgives one missed day a week, but not two in a row or two in a week", () => {
    // Missed back(2): forgiven.
    expect(streakWith([back(1), back(3), back(4)])).toMatchObject({ days: 3, graceUsed: true });
    // Two in a row end it.
    expect(streakWith([back(1), back(4), back(5)]).days).toBe(1);
    // Two misses within a week: the second ends it.
    expect(streakWith([back(1), back(3), back(5), back(6)]).days).toBe(2);
    // Misses more than a week apart are both forgiven.
    const long = [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].map(back);
    expect(streakWith(long).days).toBe(11);
  });

  it("has no streak without a goal", () => {
    expect(currentStreak(() => 1000, 0, today).days).toBe(0);
  });

  it("finds the longest run", () => {
    const totals = [600, 600, 0, 600, 600, 600, 100].map((words, i) => ({
      day: `d${i}`,
      words,
      sessions: 1,
      activeMs: 0,
    }));
    expect(longestStreak(totals, 500)).toBe(3);
  });
});
