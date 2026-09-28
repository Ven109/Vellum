import { openDB } from "idb";
import type { IDBPDatabase } from "idb";

/**
 * Where user-supplied provider keys live. Keys are only ever read by the provider adapters at request
 * time; the UI only ever sees the last four characters. See docs/adr/0002-api-keys.md.
 */
export interface KeyVault {
  readonly kind: "desktop-keychain" | "browser-encrypted";
  /** Plain-language description shown in the key setup screen. */
  readonly description: string;
  save(providerId: string, key: string): Promise<KeyInfo>;
  /** For adapters only. Never render or log the result. */
  reveal(providerId: string): Promise<string | undefined>;
  info(providerId: string): Promise<KeyInfo | undefined>;
  remove(providerId: string): Promise<void>;
}

export interface KeyInfo {
  last4: string;
  savedAt: string;
}

export function last4(key: string): string {
  return key.trim().slice(-4);
}

/** Bridge exposed by the Electron preload script (apps/desktop). Backed by OS keychain via safeStorage. */
export interface DesktopSecretsBridge {
  set(id: string, value: string): Promise<void>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
  isEncryptionAvailable(): Promise<boolean>;
}

declare global {
  interface Window {
    vellumDesktop?: { secrets?: DesktopSecretsBridge };
  }
}

export class DesktopKeyVault implements KeyVault {
  readonly kind = "desktop-keychain" as const;
  readonly description =
    "Stored in your operating system's keychain (macOS Keychain, Windows Credential Manager or libsecret on Linux), never in a plain config file.";

  constructor(private readonly bridge: DesktopSecretsBridge) {}

  async save(providerId: string, key: string) {
    const info: KeyInfo = { last4: last4(key), savedAt: new Date().toISOString() };
    await this.bridge.set(`provider-key:${providerId}`, key.trim());
    await this.bridge.set(`provider-key-info:${providerId}`, JSON.stringify(info));
    return info;
  }
  async reveal(providerId: string) {
    return (await this.bridge.get(`provider-key:${providerId}`)) ?? undefined;
  }
  async info(providerId: string) {
    const raw = await this.bridge.get(`provider-key-info:${providerId}`);
    return raw ? (JSON.parse(raw) as KeyInfo) : undefined;
  }
  async remove(providerId: string) {
    await this.bridge.delete(`provider-key:${providerId}`);
    await this.bridge.delete(`provider-key-info:${providerId}`);
  }
}

interface SealedKey {
  id: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  last4: string;
  savedAt: string;
}

/**
 * Browser storage: each key is encrypted with AES-GCM under a per-user, per-device wrapping key that is
 * generated as *non-extractable* — script (including Vellum's own) can use it to decrypt but can never
 * read its raw bytes, so copying the IndexedDB files off the machine does not reveal provider keys.
 */
export class BrowserKeyVault implements KeyVault {
  readonly kind = "browser-encrypted" as const;
  readonly description =
    "Encrypted at rest in this browser with a device key that can't be exported. It is never sent to the Vellum server.";
  private db: Promise<IDBPDatabase>;

  constructor(
    private readonly userId: string,
    dbName = "vellum-keys",
  ) {
    this.db = openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore("wrapping");
        d.createObjectStore("sealed", { keyPath: "id" });
      },
    });
  }

  private async wrappingKey(): Promise<CryptoKey> {
    const d = await this.db;
    const existing = (await d.get("wrapping", this.userId)) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await d.put("wrapping", key, this.userId);
    return key;
  }

  private sealedId(providerId: string) {
    return `${this.userId}:${providerId}`;
  }

  async save(providerId: string, key: string) {
    const wrapping = await this.wrappingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrapping,
      new TextEncoder().encode(key.trim()),
    );
    const sealed: SealedKey = {
      id: this.sealedId(providerId),
      iv,
      ciphertext,
      last4: last4(key),
      savedAt: new Date().toISOString(),
    };
    await (await this.db).put("sealed", sealed);
    return { last4: sealed.last4, savedAt: sealed.savedAt };
  }

  async reveal(providerId: string) {
    const sealed = (await (await this.db).get("sealed", this.sealedId(providerId))) as SealedKey | undefined;
    if (!sealed) return undefined;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv },
      await this.wrappingKey(),
      sealed.ciphertext,
    );
    return new TextDecoder().decode(plain);
  }

  async info(providerId: string) {
    const sealed = (await (await this.db).get("sealed", this.sealedId(providerId))) as SealedKey | undefined;
    return sealed ? { last4: sealed.last4, savedAt: sealed.savedAt } : undefined;
  }

  async remove(providerId: string) {
    await (await this.db).delete("sealed", this.sealedId(providerId));
  }

  /** Stored ciphertext, for tests and audits only. */
  async sealedRecord(providerId: string): Promise<SealedKey | undefined> {
    return (await (await this.db).get("sealed", this.sealedId(providerId))) as SealedKey | undefined;
  }
}

let vault: KeyVault | null = null;

export function getKeyVault(userId: string): KeyVault {
  if (!vault) {
    const bridge = typeof window !== "undefined" ? window.vellumDesktop?.secrets : undefined;
    vault = bridge ? new DesktopKeyVault(bridge) : new BrowserKeyVault(userId);
  }
  return vault;
}

export function setKeyVaultForTests(v: KeyVault | null): void {
  vault = v;
}
