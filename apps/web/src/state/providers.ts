import { create } from "zustand";
import { keyInfo, listProviders, removeProvider, saveProvider } from "../data/providers.js";
import type { StoredProvider } from "../data/providers.js";
import type { KeyInfo } from "../data/keys.js";
import { useApp } from "./app.js";

interface ProvidersState {
  loaded: boolean;
  providers: StoredProvider[];
  keys: Record<string, KeyInfo | undefined>;
  load(): Promise<void>;
  save(provider: StoredProvider, key?: string): Promise<void>;
  remove(id: string): Promise<void>;
  setDefault(providerId: string, model: string): Promise<void>;
}

export const useProviders = create<ProvidersState>((set, get) => ({
  loaded: false,
  providers: [],
  keys: {},
  async load() {
    const providers = await listProviders();
    const keys: Record<string, KeyInfo | undefined> = {};
    for (const p of providers) keys[p.id] = await keyInfo(p.id);
    set({ providers, keys, loaded: true });
  },
  async save(provider, key) {
    await saveProvider(provider, key);
    const ws = useApp.getState().workspace;
    if (!ws?.settings.defaultModel) await get().setDefault(provider.id, provider.defaultModel);
    await get().load();
  },
  async remove(id) {
    await removeProvider(id);
    const ws = useApp.getState().workspace;
    if (ws?.settings.defaultModel?.providerId === id) {
      const next = get().providers.find((p) => p.id !== id);
      await useApp.getState().updateWorkspaceSettings({
        defaultModel: next ? { providerId: next.id, model: next.defaultModel } : undefined,
      });
    }
    await get().load();
  },
  async setDefault(providerId, model) {
    await useApp.getState().updateWorkspaceSettings({ defaultModel: { providerId, model } });
  },
}));
