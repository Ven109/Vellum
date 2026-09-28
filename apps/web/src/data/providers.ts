import type { ProviderConfig } from "@vellum/ai";
import { useApp } from "../state/app.js";
import { getKeyVault } from "./keys.js";

/** Provider settings are stored without keys; keys live only in the {@link KeyVault}. */
export type StoredProvider = Omit<ProviderConfig, "apiKey">;

const SETTING = "providers";

export async function listProviders(): Promise<StoredProvider[]> {
  return (await useApp.getState().repo.getSetting<StoredProvider[]>(SETTING)) ?? [];
}

export async function saveProvider(provider: StoredProvider, key?: string): Promise<void> {
  const repo = useApp.getState().repo;
  const all = await listProviders();
  const safe: StoredProvider = {
    id: provider.id,
    kind: provider.kind,
    label: provider.label,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
  };
  await repo.putSetting(SETTING, [...all.filter((p) => p.id !== provider.id), safe]);
  if (key) await vault().save(provider.id, key);
}

/** Revoke: forget the key on this device and remove the provider. */
export async function removeProvider(id: string): Promise<void> {
  const repo = useApp.getState().repo;
  await repo.putSetting(
    SETTING,
    (await listProviders()).filter((p) => p.id !== id),
  );
  await vault().remove(id);
}

/** Attach the key at the moment of a request. The returned object must not be stored or logged. */
export async function withKey(provider: StoredProvider): Promise<ProviderConfig> {
  return { ...provider, apiKey: await vault().reveal(provider.id) };
}

function vault() {
  const user = useApp.getState().user;
  if (!user) throw new Error("No user");
  return getKeyVault(user.id);
}

export async function keyInfo(id: string) {
  return vault().info(id);
}

export function vaultDescription(): string {
  return vault().description;
}

/** Strip anything that looks like a known key from text before it is shown or logged. */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join(`••••${s.slice(-4)}`);
  return out;
}
