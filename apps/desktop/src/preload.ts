import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

/**
 * The page's only access to the system. Everything goes through named IPC calls that the main process
 * validates; no Node APIs are exposed.
 */
function listen<T>(channel: string, fn: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => fn(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("vellumDesktop", {
  platform: process.platform,
  secrets: {
    set: (id: string, value: string) => ipcRenderer.invoke("secrets:set", id, value) as Promise<void>,
    get: (id: string) => ipcRenderer.invoke("secrets:get", id) as Promise<string | null>,
    delete: (id: string) => ipcRenderer.invoke("secrets:delete", id) as Promise<void>,
    isEncryptionAvailable: () => ipcRenderer.invoke("secrets:available") as Promise<boolean>,
  },
  openWindow: (path: string) => ipcRenderer.invoke("window:open", path) as Promise<void>,
  setCurrentPath: (path: string) => ipcRenderer.send("window:path", path),
  onCommand: (fn: (command: unknown) => void) => listen("command", fn),
  onImportFiles: (fn: (files: unknown) => void) => listen("import-files", fn),
  updates: {
    getSettings: () => ipcRenderer.invoke("updates:settings"),
    setSettings: (patch: unknown) => ipcRenderer.invoke("updates:set", patch),
    check: () => ipcRenderer.invoke("updates:check") as Promise<void>,
    install: () => ipcRenderer.invoke("updates:install") as Promise<void>,
    onStatus: (fn: (status: unknown) => void) => {
      void ipcRenderer.invoke("updates:status").then((s) => s && fn(s));
      return listen("updates:status", fn);
    },
  },
});
