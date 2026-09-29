/**
 * Writing sessions, daily goals and streaks. Pure functions over session records; storage and tracking
 * live in the app. Days are local calendar days (YYYY-MM-DD) in the writer's time zone.
 */
export interface WritingSession {
  id: string;
  userId: string;
  documentId: string;
  /** The document's collection when the session ended, for breakdowns. */
  collectionId: string | null;
  startedAt: string;
  endedAt: string;
  /** Net words added (never negative). */
  wordsAdded: number;
  /** Net words removed (never negative). */
  wordsRemoved: number;
  /** Time spent actively writing, excluding idle gaps. */
  activeMs: number;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export interface DayTotal {
  day: string;
  words: number;
  sessions: number;
  activeMs: number;
}

/** Totals per day (by each session's end), including empty days, oldest first. */
export function dailyTotals(sessions: WritingSession[], from: string, to: string): DayTotal[] {
  const byDay = new Map<string, DayTotal>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, { day: d, words: 0, sessions: 0, activeMs: 0 });
  for (const s of sessions) {
    const t = byDay.get(dayKey(new Date(s.endedAt)));
    if (!t) continue;
    t.words += s.wordsAdded;
    t.sessions += 1;
    t.activeMs += s.activeMs;
  }
  return [...byDay.values()];
}

export function wordsOn(sessions: WritingSession[], day: string): number {
  return sessions.filter((s) => dayKey(new Date(s.endedAt)) === day).reduce((n, s) => n + s.wordsAdded, 0);
}

/**
 * The streak rule, in plain words: a day counts when you meet your goal. Today never breaks a streak
 * (it isn't over yet). You may miss one day in any seven without losing your streak — a grace day —
 * but two missed days in a row, or two within a week, end it. Grace days don't add to the count.
 */
export const STREAK_RULE =
  "Meet your goal to keep the streak going. Missing one day in a week is forgiven; two missed days end it.";

export function currentStreak(
  wordsByDay: (day: string) => number,
  goal: number,
  today: string,
): { days: number; graceUsed: boolean; metToday: boolean } {
  const met = (d: string) => goal > 0 && wordsByDay(d) >= goal;
  const metToday = met(today);
  let days = metToday ? 1 : 0;
  let lastGrace: string | null = null;
  let graceUsed = false;
  let day = addDays(today, -1);
  for (let i = 0; i < 3660; i++, day = addDays(day, -1)) {
    if (met(day)) {
      days++;
      continue;
    }
    // A miss: forgiven if the day before counts and no other grace day falls within the same week.
    const previousMet = met(addDays(day, -1));
    const withinWeekOfLastGrace = lastGrace !== null && daysBetween(day, lastGrace) < 7;
    if (days > 0 && previousMet && !withinWeekOfLastGrace) {
      lastGrace = day;
      graceUsed = true;
      continue;
    }
    break;
  }
  return { days, graceUsed, metToday };
}

function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`)) / 86_400_000);
}

export function longestStreak(totals: DayTotal[], goal: number): number {
  let best = 0;
  let run = 0;
  for (const t of totals) {
    run = goal > 0 && t.words >= goal ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export interface InsightsSummary {
  days: DayTotal[];
  words: number;
  averagePerDay: number;
  activeMs: number;
  sessions: number;
  goalDays: number;
  longestStreak: number;
  /** Words per collection id (null for unfiled), largest first. */
  byCollection: Array<{ collectionId: string | null; words: number }>;
  /** Documents written in during the range, most words first. */
  documents: Array<{ documentId: string; words: number }>;
}

export function summarize(
  sessions: WritingSession[],
  from: string,
  to: string,
  goal: number,
): InsightsSummary {
  const days = dailyTotals(sessions, from, to);
  const inRange = sessions.filter((s) => {
    const d = dayKey(new Date(s.endedAt));
    return d >= from && d <= to;
  });
  const words = days.reduce((n, d) => n + d.words, 0);
  const tally = <K>(key: (s: WritingSession) => K) => {
    const m = new Map<K, number>();
    for (const s of inRange) m.set(key(s), (m.get(key(s)) ?? 0) + s.wordsAdded);
    return [...m].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  };
  return {
    days,
    words,
    averagePerDay: days.length ? Math.round(words / days.length) : 0,
    activeMs: days.reduce((n, d) => n + d.activeMs, 0),
    sessions: inRange.length,
    goalDays: days.filter((d) => goal > 0 && d.words >= goal).length,
    longestStreak: longestStreak(days, goal),
    byCollection: tally((s) => s.collectionId).map(([collectionId, w]) => ({ collectionId, words: w })),
    documents: tally((s) => s.documentId).map(([documentId, w]) => ({ documentId, words: w })),
  };
}

export function insightsCsv(days: DayTotal[], goal: number): string {
  const rows = days.map((d) =>
    [
      d.day,
      d.words,
      d.sessions,
      Math.round(d.activeMs / 60_000),
      goal > 0 && d.words >= goal ? "yes" : "no",
    ].join(","),
  );
  return ["date,words,sessions,minutes,goal_met", ...rows].join("\n") + "\n";
}
