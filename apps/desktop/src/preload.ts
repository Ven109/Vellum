import { contextBridge, ipcRenderer } from "electron";

/**
 * The page's only access to the system. Everything goes through named IPC calls that the main process
 * validates; no Node APIs are exposed.
 */
contextBridge.exposeInMainWorld("vellumDesktop", {
  platform: process.platform,
  secrets: {
    set: (id: string, value: string) => ipcRenderer.invoke("secrets:set", id, value) as Promise<void>,
    get: (id: string) => ipcRenderer.invoke("secrets:get", id) as Promise<string | null>,
    delete: (id: string) => ipcRenderer.invoke("secrets:delete", id) as Promise<void>,
    isEncryptionAvailable: () => ipcRenderer.invoke("secrets:available") as Promise<boolean>,
  },
});
