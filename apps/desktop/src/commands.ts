import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { BrowserWindow } from "electron";

export type Command =
  { type: "new-draft" } | { type: "navigate"; path: string } | { type: "toggle-focus" } | { type: "palette" };

export function sendCommand(win: BrowserWindow, command: Command) {
  const send = () => win.webContents.send("command", command);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

const IMPORTABLE = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".zip", ".docx"]);
const MAX_BYTES = 50 * 1024 * 1024;

export function isImportable(file: string) {
  return IMPORTABLE.has(extname(file).toLowerCase());
}

/** Read files opened with the app (Finder, the dock, "Open with…", File → Import) and hand them over. */
export async function sendFilesToImport(win: BrowserWindow, files: string[]) {
  const payload: Array<{ path: string; data: Uint8Array }> = [];
  for (const f of files.filter(isImportable)) {
    try {
      if ((await stat(f)).size > MAX_BYTES) continue;
      payload.push({ path: basename(f), data: new Uint8Array(await readFile(f)) });
    } catch {
      /* unreadable: skip */
    }
  }
  if (!payload.length) return;
  const send = () => win.webContents.send("import-files", payload);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}
