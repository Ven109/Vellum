import { create } from "zustand";

/**
 * First-run setup, offered to whoever creates a workspace (the admin at server setup, someone signing up
 * on an open server, or the first launch without a server). It's kept on this device so it can be
 * resumed where you left off, and it can be skipped at any point.
 */
export interface OnboardingProgress {
  status: "pending" | "done";
  step: number;
  kinds: string[];
}

const KEY = "vellum:onboarding";

function load(): OnboardingProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OnboardingProgress) : null;
  } catch {
    return null;
  }
}

function save(p: OnboardingProgress | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: progress lasts for this session */
  }
}

interface OnboardingState {
  progress: OnboardingProgress | null;
  /** A workspace was just created here: offer setup. */
  start(): void;
  goTo(step: number): void;
  setKinds(kinds: string[]): void;
  finish(): void;
}

export const useOnboarding = create<OnboardingState>((set, get) => {
  const update = (p: OnboardingProgress | null) => {
    save(p);
    set({ progress: p });
  };
  return {
    progress: load(),
    start() {
      update({ status: "pending", step: 0, kinds: [] });
    },
    goTo(step) {
      const p = get().progress ?? { status: "pending", step: 0, kinds: [] };
      update({ ...p, step });
    },
    setKinds(kinds) {
      const p = get().progress ?? { status: "pending", step: 0, kinds: [] };
      update({ ...p, kinds });
    },
    finish() {
      const p = get().progress ?? { status: "pending", step: 0, kinds: [] };
      update({ ...p, status: "done" });
    },
  };
});

export const onboardingPending = () => useOnboarding.getState().progress?.status === "pending";

/** What you write: each becomes a collection, if you don't have one by that name already. */
export const WRITING_KINDS = [
  { id: "essays", label: "Essays", hint: "Arguments, reviews, personal pieces" },
  { id: "fiction", label: "Fiction", hint: "Stories, novels, chapters" },
  { id: "newsletters", label: "Newsletters", hint: "Regular issues for readers" },
  { id: "technical", label: "Technical docs", hint: "Guides, specs, READMEs" },
  { id: "research", label: "Research", hint: "Papers, notes, literature reviews" },
  { id: "journal", label: "Journal", hint: "Daily pages and reflections" },
  { id: "scripts", label: "Scripts", hint: "Screenplays, talks, podcasts" },
  { id: "poetry", label: "Poetry", hint: "Poems and lyrics" },
] as const;
