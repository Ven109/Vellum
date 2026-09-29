import { STREAK_RULE, currentStreak, dayKey, wordsOn } from "@vellum/core";
import type { WritingSession } from "@vellum/core";
import { create } from "zustand";
import { useApp } from "./app.js";

/** How long without typing ends a session. */
export const IDLE_END_MS = 5 * 60_000;
/** Gaps longer than this between keystrokes don't count as writing time. */
export const ACTIVE_GAP_MS = 60_000;

interface WritingState {
  goal: number;
  todayWords: number;
  /** Net words in the session in progress (not saved yet). */
  liveWords: number;
  streak: number;
  metToday: boolean;
  loaded: boolean;
  /** Increments whenever a session is saved, so views can refresh. */
  saved: number;
  load(): Promise<void>;
  setGoal(words: number): Promise<void>;
  saveSession(s: WritingSession): Promise<void>;
}

export { STREAK_RULE };

/**
 * Daily goal, today's words and the streak. Sessions are stored only on this device (IndexedDB) and
 * never leave it, so this stays private to the writer.
 */
export const useWriting = create<WritingState>((set, get) => ({
  goal: 500,
  todayWords: 0,
  liveWords: 0,
  streak: 0,
  metToday: false,
  loaded: false,
  saved: 0,

  async load() {
    const { repo, workspace } = useApp.getState();
    const goal = (await repo.getSetting<number>("dailyGoal")) ?? workspace?.settings.dailyGoalWords ?? 500;
    const now = new Date();
    const from = new Date(now);
    from.setFullYear(now.getFullYear() - 1);
    const sessions = await repo.listSessions(from.toISOString(), now.toISOString());
    const today = dayKey(now);
    const byDay = new Map<string, number>();
    for (const s of sessions) {
      const d = dayKey(new Date(s.endedAt));
      byDay.set(d, (byDay.get(d) ?? 0) + s.wordsAdded);
    }
    const streak = currentStreak((d) => byDay.get(d) ?? 0, goal, today);
    set({
      goal,
      todayWords: wordsOn(sessions, today),
      streak: streak.days,
      metToday: streak.metToday,
      loaded: true,
    });
  },

  async setGoal(words) {
    const goal = Math.max(1, Math.round(words));
    await useApp.getState().repo.putSetting("dailyGoal", goal);
    set({ goal });
    await get().load();
  },

  async saveSession(s) {
    await useApp.getState().repo.putSession(s);
    set({ liveWords: 0, saved: get().saved + 1 });
    await get().load();
  },
}));
