import { describe, expect, it } from "vitest";
import { BrowserKeyVault, DesktopKeyVault } from "../src/data/keys.js";
import type { DesktopSecretsBridge } from "../src/data/keys.js";

describe("BrowserKeyVault", () => {
  it("encrypts keys at rest and only exposes the last four characters as metadata", async () => {
    const vault = new BrowserKeyVault("usr_1", `keys-${Math.random()}`);
    const info = await vault.save("anthropic", "  sk-ant-secret-value-1234 ");
    expect(info.last4).toBe("1234");
    const sealed = await vault.sealedRecord("anthropic");
    const bytes = new Uint8Array(sealed!.ciphertext);
    expect(new TextDecoder().decode(bytes)).not.toContain("secret");
    expect(JSON.stringify(sealed)).not.toContain("sk-ant");
    expect(await vault.reveal("anthropic")).toBe("sk-ant-secret-value-1234");
    expect(await vault.info("anthropic")).toMatchObject({ last4: "1234" });
  });

  it("rotates and revokes", async () => {
    const vault = new BrowserKeyVault("usr_1", `keys-${Math.random()}`);
    await vault.save("openai", "sk-old-aaaa");
    await vault.save("openai", "sk-new-bbbb");
    expect(await vault.reveal("openai")).toBe("sk-new-bbbb");
    await vault.remove("openai");
    expect(await vault.reveal("openai")).toBeUndefined();
    expect(await vault.info("openai")).toBeUndefined();
  });

  it("keeps keys separate per user", async () => {
    const name = `keys-${Math.random()}`;
    await new BrowserKeyVault("usr_a", name).save("anthropic", "key-for-a");
    expect(await new BrowserKeyVault("usr_b", name).reveal("anthropic")).toBeUndefined();
  });
});

describe("DesktopKeyVault", () => {
  it("stores keys through the keychain bridge", async () => {
    const store = new Map<string, string>();
    const bridge: DesktopSecretsBridge = {
      set: async (k, v) => void store.set(k, v),
      get: async (k) => store.get(k) ?? null,
      delete: async (k) => void store.delete(k),
      isEncryptionAvailable: async () => true,
    };
    const vault = new DesktopKeyVault(bridge);
    await vault.save("anthropic", "sk-ant-xyz-9876");
    expect(await vault.reveal("anthropic")).toBe("sk-ant-xyz-9876");
    expect((await vault.info("anthropic"))?.last4).toBe("9876");
    await vault.remove("anthropic");
    expect(store.size).toBe(0);
  });
});

describe("redact", () => {
  it("masks keys echoed back in provider messages", async () => {
    const { redact } = await import("../src/data/providers.js");
    expect(redact("Invalid key sk-ant-abcdefgh1234 provided", ["sk-ant-abcdefgh1234"])).toBe(
      "Invalid key ••••1234 provided",
    );
    expect(redact("nothing here", [undefined, "short"])).toBe("nothing here");
  });
});
