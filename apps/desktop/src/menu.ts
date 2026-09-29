import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, shell, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sendCommand, sendFilesToImport } from "./commands.js";
import { checkForUpdates } from "./updates.js";
import { activeWindow, createWindow } from "./windows.js";

const DOCS = "https://github.com/Ven109/Vellum/tree/main/docs";
const ISSUES = "https://github.com/Ven109/Vellum/issues/new";
export const NEW_DRAFT_SHORTCUT = "CommandOrControl+Alt+N";

export function newDraft() {
  sendCommand(activeWindow(), { type: "new-draft" });
}

async function importFiles() {
  const win = activeWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Import",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: ["md", "markdown", "txt", "html", "htm", "docx", "zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result.canceled) await sendFilesToImport(win, result.filePaths);
}

const toWindow = (command: Parameters<typeof sendCommand>[1]) => () => sendCommand(activeWindow(), command);

export function buildMenu() {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { id: "new-draft", label: "New Draft", accelerator: "CmdOrCtrl+N", click: newDraft },
        {
          id: "new-window",
          label: "New Window",
          accelerator: "Shift+CmdOrCtrl+N",
          click: () => createWindow("/library"),
        },
        { type: "separator" },
        { id: "import", label: "Import…", accelerator: "CmdOrCtrl+O", click: () => void importFiles() },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          id: "palette",
          label: "Command Palette",
          accelerator: "CmdOrCtrl+K",
          click: toWindow({ type: "palette" }),
        },
        {
          id: "focus",
          label: "Focus Mode",
          accelerator: "Shift+CmdOrCtrl+F",
          click: toWindow({ type: "toggle-focus" }),
        },
        {
          id: "library",
          label: "Library",
          accelerator: "CmdOrCtrl+1",
          click: toWindow({ type: "navigate", path: "/library" }),
        },
        {
          id: "settings",
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: toWindow({ type: "navigate", path: "/settings/account" }),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { id: "docs", label: "Vellum Help", click: () => void shell.openExternal(DOCS) },
        { id: "report", label: "Report an Issue…", click: () => void shell.openExternal(ISSUES) },
        { type: "separator" },
        {
          id: "check-updates",
          label: "Check for Updates…",
          click: () => {
            sendCommand(activeWindow(), { type: "navigate", path: "/settings/updates" });
            void checkForUpdates();
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function quickMenu() {
  return Menu.buildFromTemplate([
    { label: "New Draft", click: newDraft },
    { label: "New Window", click: () => createWindow("/library") },
    { label: "Show Vellum", click: () => activeWindow() },
    ...(process.platform === "darwin"
      ? []
      : [{ type: "separator" as const }, { label: "Quit Vellum", role: "quit" as const }]),
  ]);
}

let tray: Tray | null = null;

function trayIcon() {
  const candidates = [
    join(process.resourcesPath ?? "", "icon.png"),
    join(app.getAppPath(), "build", "icon.png"),
  ];
  const file = candidates.find((f) => existsSync(f));
  return file
    ? nativeImage.createFromPath(file).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty();
}

/** The dock menu on macOS; a tray icon on Windows and Linux. */
export function buildQuickAccess() {
  if (process.platform === "darwin") {
    app.dock?.setMenu(quickMenu());
    return;
  }
  if (process.env.VELLUM_NO_TRAY) return;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip("Vellum");
    tray.setContextMenu(quickMenu());
    tray.on("click", () => activeWindow());
  } catch {
    tray = null; // No system tray (some Linux desktops): nothing to add.
  }
}

/** A system-wide shortcut to start a new draft from anywhere. */
export function registerGlobalShortcut() {
  try {
    globalShortcut.register(NEW_DRAFT_SHORTCUT, newDraft);
  } catch {
    /* taken by another app */
  }
  app.on("will-quit", () => globalShortcut.unregisterAll());
}

export function openWindowCount() {
  return BrowserWindow.getAllWindows().length;
}
