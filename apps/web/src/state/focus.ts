import { countWords } from "@vellum/core";
import { create } from "zustand";
import { useDocSession } from "./session.js";

export type Dimming = "typewriter" | "paragraph" | "off";

export interface Sprint {
  minutes: number;
  /** Time left when paused; while running, derived from `endsAt`. */
  remainingMs: number;
  endsAt: number | null;
  startWords: number;
  finished: boolean;
  wordsWritten?: number;
}

interface FocusState {
  active: boolean;
  dimming: Dimming;
  goal: number;
  startedAt: number;
  startWords: number;
  sprint: Sprint | null;
  enter(): void;
  exit(): void;
  toggle(): void;
  setDimming(d: Dimming): void;
  setGoal(words: number): void;
  startSprint(minutes: number): void;
  pauseSprint(): void;
  resumeSprint(): void;
  cancelSprint(): void;
  /** Called by the HUD's clock; finishes the sprint when its time is up. */
  tick(now?: number): void;
}

const PREFS = "vellum:focus";

function loadPrefs(): { dimming: Dimming; goal: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as { dimming?: Dimming; goal?: number };
    return {
      dimming:
        raw.dimming && ["typewriter", "paragraph", "off"].includes(raw.dimming) ? raw.dimming : "paragraph",
      goal: raw.goal && raw.goal > 0 ? raw.goal : 500,
    };
  } catch {
    return { dimming: "paragraph", goal: 500 };
  }
}

function savePrefs(p: { dimming: Dimming; goal: number }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Current word count, read from the editor so it isn't behind the debounced stats. */
const words = () => {
  const { editor, wordCount } = useDocSession.getState();
  if (!editor) return wordCount;
  const doc = editor.state.doc;
  return countWords(doc.textBetween(0, doc.content.size, "\n", " "));
};

export function sprintRemaining(s: Sprint, now = Date.now()): number {
  return s.endsAt ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

export const useFocus = create<FocusState>((set, get) => ({
  active: false,
  ...loadPrefs(),
  startedAt: 0,
  startWords: 0,
  sprint: null,

  enter() {
    if (get().active) return;
    set({ active: true, startedAt: Date.now(), startWords: words(), sprint: null });
  },
  exit() {
    set({ active: false, sprint: null });
  },
  toggle() {
    if (get().active) get().exit();
    else get().enter();
  },
  setDimming(dimming) {
    set({ dimming });
    savePrefs({ dimming, goal: get().goal });
  },
  setGoal(goal) {
    const g = Math.max(1, Math.round(goal));
    set({ goal: g });
    savePrefs({ dimming: get().dimming, goal: g });
  },
  startSprint(minutes) {
    const ms = minutes * 60_000;
    set({
      sprint: { minutes, remainingMs: ms, endsAt: Date.now() + ms, startWords: words(), finished: false },
    });
  },
  pauseSprint() {
    const s = get().sprint;
    if (!s?.endsAt) return;
    set({ sprint: { ...s, remainingMs: sprintRemaining(s), endsAt: null } });
  },
  resumeSprint() {
    const s = get().sprint;
    if (!s || s.endsAt || s.finished) return;
    set({ sprint: { ...s, endsAt: Date.now() + s.remainingMs } });
  },
  cancelSprint() {
    set({ sprint: null });
  },
  tick(now = Date.now()) {
    const s = get().sprint;
    if (s?.endsAt && sprintRemaining(s, now) === 0) {
      set({
        sprint: {
          ...s,
          remainingMs: 0,
          endsAt: null,
          finished: true,
          wordsWritten: Math.max(0, words() - s.startWords),
        },
      });
    }
  },
}));
