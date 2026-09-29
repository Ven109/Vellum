import { EditorPreferences } from "@vellum/core";
import { create } from "zustand";
import { applyTheme } from "../components/CoreCommands.js";
import { useApp } from "./app.js";

const KEY = "editorPreferences";

export const FONT_STACK: Record<EditorPreferences["font"], string> = {
  serif: "var(--serif)",
  sans: "var(--sans)",
  mono: "var(--mono)",
};

export const MEASURE: Record<EditorPreferences["measure"], string> = {
  narrow: "58ch",
  medium: "68ch",
  wide: "82ch",
};

interface PreferencesState {
  prefs: EditorPreferences;
  load(): Promise<void>;
  update(patch: Partial<EditorPreferences>): Promise<void>;
}

/** Your editor preferences on this device: font, line length, theme and spellcheck. */
export const usePreferences = create<PreferencesState>((set, get) => ({
  prefs: EditorPreferences.parse({}),
  async load() {
    const saved = await useApp.getState().repo.getSetting<unknown>(KEY);
    const parsed = EditorPreferences.safeParse(saved ?? {});
    let prefs = parsed.success ? parsed.data : EditorPreferences.parse({});
    // The theme also lives in localStorage so it applies before the app loads.
    try {
      const theme = localStorage.getItem("vellum:theme");
      if (theme === "light" || theme === "dark" || theme === "system") prefs = { ...prefs, theme };
    } catch {
      /* ignore */
    }
    set({ prefs });
  },
  async update(patch) {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    if (patch.theme) applyTheme(patch.theme);
    await useApp.getState().repo.putSetting(KEY, prefs);
  },
}));
