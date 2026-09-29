import { join } from "node:path";
import { app, BrowserWindow, dialog, screen, shell } from "electron";
import type { WebContents } from "electron";
import { settings, updateSettings } from "./settings.js";
import type { WindowState } from "./settings.js";

export const ORIGIN = "app://vellum";

const paths = new Map<number, string>();
const startedAt = Date.now();

const hardened = new WeakSet<WebContents>();

function harden(contents: WebContents) {
  // Windows are hardened when created and again by web-contents-created; attach the handlers once, or a
  // web link would open twice.
  if (hardened.has(contents)) return;
  hardened.add(contents);
  // Stay on our own origin; links to the web open in the default browser.
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function hardenContents(contents: WebContents) {
  harden(contents);
}

/** Only restore bounds that are still on a connected display. */
function visible(bounds: WindowState["bounds"]) {
  if (!bounds) return undefined;
  const area = screen.getDisplayMatching(bounds).workArea;
  const overlaps =
    bounds.x < area.x + area.width &&
    bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height &&
    bounds.y + bounds.height > area.y;
  return overlaps ? bounds : undefined;
}

let quitting = false;
const unloadTries = new Map<number, number>();

/**
 * The page blocks unloading while a save is still in flight. Electron would silently keep the window
 * open, so give the save a moment and try again; if it still hasn't finished, ask.
 */
function guardUnload(win: BrowserWindow) {
  win.webContents.on("will-prevent-unload", (event) => {
    const tries = unloadTries.get(win.id) ?? 0;
    if (tries < 10) {
      unloadTries.set(win.id, tries + 1);
      setTimeout(() => {
        if (win.isDestroyed()) return;
        if (quitting) app.quit();
        else win.close();
      }, 200);
      return;
    }
    unloadTries.delete(win.id);
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Close Anyway", "Keep Writing"],
      defaultId: 1,
      cancelId: 1,
      message: "Some changes haven't been saved yet.",
      detail: "If you close now, your latest edits may be lost.",
    });
    if (choice === 0) event.preventDefault();
    else quitting = false;
  });
}

/** On quit, remember every open window once (closing them one by one must not shrink the list). */
export function rememberWindowsForQuit() {
  if (quitting) return;
  saveWindows();
  quitting = true;
}

function saveWindows() {
  if (quitting) return;
  const list: WindowState[] = BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed())
    .map((w) => ({
      path: paths.get(w.id) ?? "/",
      bounds: w.getNormalBounds(),
      maximized: w.isMaximized(),
    }));
  if (list.length) updateSettings({ windows: list });
}

export function createWindow(path = "/", state?: WindowState): BrowserWindow {
  const bounds = visible(state?.bounds);
  const focused = BrowserWindow.getFocusedWindow();
  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 860,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Vellum",
    backgroundColor: "#fdfbf7",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  // New windows cascade from the one you were in.
  if (!bounds && focused) {
    const [x, y] = focused.getPosition();
    win.setPosition(x! + 28, y! + 28);
  }
  harden(win.webContents);
  guardUnload(win);
  paths.set(win.id, path);
  win.once("ready-to-show", () => {
    if (state?.maximized) win.maximize();
    if (!process.env.VELLUM_HIDE_WINDOWS) win.show();
  });
  for (const e of ["resize", "move", "maximize", "unmaximize"] as const) win.on(e as "resize", saveWindows);
  win.on("close", saveWindows);
  win.on("closed", () => {
    paths.delete(win.id);
    saveWindows();
  });
  if (process.env.VELLUM_MEASURE_STARTUP) {
    win.webContents.once("did-finish-load", () => {
      console.log(`VELLUM_STARTUP_MS=${Date.now() - startedAt}`);
      app.quit();
    });
  }
  void win.loadURL(`${ORIGIN}${path}`);
  return win;
}

/** The renderer tells us where each window is, so a document is only ever open in one window. */
export function setWindowPath(id: number, path: string) {
  paths.set(id, path);
  saveWindows();
}

export function windowShowing(path: string): BrowserWindow | undefined {
  const doc = /^\/d\/[^/?#]+/.exec(path)?.[0];
  if (!doc) return undefined;
  return BrowserWindow.getAllWindows().find((w) => /^\/d\/[^/?#]+/.exec(paths.get(w.id) ?? "")?.[0] === doc);
}

/** Open a path (usually a document): focus the window already showing it, or open a new one. */
export function openPath(path: string): BrowserWindow {
  const existing = windowShowing(path);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  return createWindow(path);
}

/** The window to act on: the focused one, the last used, or a new one. */
export function activeWindow(): BrowserWindow {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? createWindow("/");
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return w;
}

export function restoreWindows() {
  const saved = settings().windows.slice(0, 8);
  if (!saved.length) return void createWindow("/");
  for (const s of saved) createWindow(s.path || "/", s);
}

export function windowPath(id: number): string | undefined {
  return paths.get(id);
}
