import { describe, expect, it } from "vitest";
import { easeLabel, readability, syllables } from "../src/readability.js";
import { insightsCsv, summarize } from "../src/sessions.js";
import type { WritingSession } from "../src/sessions.js";

const s = (day: string, words: number, collectionId: string | null, documentId = "d1"): WritingSession => ({
  id: `${day}${words}${documentId}`,
  userId: "u",
  documentId,
  collectionId,
  startedAt: `${day}T09:00:00`,
  endedAt: `${day}T10:00:00`,
  wordsAdded: words,
  wordsRemoved: 0,
  activeMs: 20 * 60_000,
});

describe("insights", () => {
  const sessions = [
    s("2026-03-01", 600, "c1"),
    s("2026-03-02", 200, "c2", "d2"),
    s("2026-03-02", 100, null, "d3"),
    s("2026-03-03", 700, "c1"),
    s("2026-02-01", 5000, "c1"),
  ];

  it("summarises a range: totals, averages, goal days, breakdowns", () => {
    const r = summarize(sessions, "2026-03-01", "2026-03-04", 500);
    expect(r).toMatchObject({ words: 1600, averagePerDay: 400, sessions: 4, goalDays: 2, longestStreak: 1 });
    expect(r.activeMs).toBe(80 * 60_000);
    expect(r.byCollection).toEqual([
      { collectionId: "c1", words: 1300 },
      { collectionId: "c2", words: 200 },
      { collectionId: null, words: 100 },
    ]);
    expect(r.documents[0]).toEqual({ documentId: "d1", words: 1300 });
  });

  it("exports CSV", () => {
    const r = summarize(sessions, "2026-03-01", "2026-03-02", 500);
    expect(insightsCsv(r.days, 500)).toBe(
      "date,words,sessions,minutes,goal_met\n2026-03-01,600,1,20,yes\n2026-03-02,300,2,40,no\n",
    );
  });
});

describe("readability", () => {
  it("counts syllables roughly", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("table")).toBe(2);
    expect(syllables("readability")).toBe(5);
    expect(syllables("makes")).toBe(1);
  });

  it("scores simple prose as easy and dense prose as difficult", () => {
    const simple = "The cat sat on the mat. It was a warm day. The sun was out. We went for a walk. ".repeat(
      3,
    );
    const dense =
      "Institutional considerations notwithstanding, comprehensive organizational restructuring necessitates extraordinarily meticulous administrative coordination across interdependent departmental responsibilities, particularly regarding implementation. ".repeat(
        3,
      );
    expect(readability(simple)!.ease).toBeGreaterThan(80);
    expect(readability(dense)!.ease).toBeLessThan(30);
    expect(readability(dense)!.grade).toBeGreaterThan(readability(simple)!.grade);
    expect(readability("Too short.")).toBeNull();
    expect(easeLabel(65)).toBe("Plain English");
  });
});
