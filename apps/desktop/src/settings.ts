import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { Rectangle } from "electron";

export interface WindowState {
  path: string;
  bounds?: Rectangle;
  maximized?: boolean;
}

export interface DesktopSettings {
  autoUpdate: boolean;
  channel: "latest" | "beta";
  windows: WindowState[];
}

const DEFAULTS: DesktopSettings = { autoUpdate: true, channel: "latest", windows: [] };
let current: DesktopSettings | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const file = () => join(app.getPath("userData"), "desktop-settings.json");

/** The desktop app's own settings (windows, updates), kept in the user data folder. */
export function settings(): DesktopSettings {
  if (!current) {
    try {
      current = { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), "utf8")) as Partial<DesktopSettings>) };
    } catch {
      current = { ...DEFAULTS };
    }
  }
  return current;
}

export function updateSettings(patch: Partial<DesktopSettings>, immediately = false): DesktopSettings {
  current = { ...settings(), ...patch };
  clearTimeout(timer);
  if (immediately) flushSettings();
  else timer = setTimeout(flushSettings, 300);
  return current;
}

export function flushSettings(): void {
  clearTimeout(timer);
  if (!current) return;
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(current, null, 2));
}
