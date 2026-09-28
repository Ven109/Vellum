import type { ReactNode } from "react";
import { create } from "zustand";

export interface Command {
  id: string;
  title: string;
  section?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: ReactNode;
  /** Hide the command when it does not apply (e.g. "Close split" outside split view). */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

interface CommandState {
  commands: Command[];
  paletteOpen: boolean;
  register(commands: Command[]): () => void;
  openPalette(initialQuery?: string): void;
  closePalette(): void;
  initialQuery: string;
}

/** Global command registry. Features register commands; the palette lists and runs them. */
export const useCommands = create<CommandState>((set, get) => ({
  commands: [],
  paletteOpen: false,
  initialQuery: "",
  register(commands) {
    const ids = new Set(commands.map((c) => c.id));
    set({ commands: [...get().commands.filter((c) => !ids.has(c.id)), ...commands] });
    return () => set({ commands: get().commands.filter((c) => !ids.has(c.id)) });
  },
  openPalette(initialQuery = "") {
    set({ paletteOpen: true, initialQuery });
  },
  closePalette() {
    set({ paletteOpen: false });
  },
}));

export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
