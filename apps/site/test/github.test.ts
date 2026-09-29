import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStars, formatCount } from "../src/github.js";

describe("formatCount", () => {
  it("keeps small numbers exact and abbreviates large ones", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(12_345)).toBe("12k");
    expect(formatCount(999_499)).toBe("999k");
    expect(formatCount(1_250_000)).toBe("1.3M");
  });

  it("gives nothing for nonsense", () => {
    expect(formatCount(-1)).toBe("");
    expect(formatCount(Number.NaN)).toBe("");
  });
});

describe("fetchStars", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });

  const reply = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

  it("reads the count and caches it", async () => {
    const f = reply({ stargazers_count: 4321 });
    expect(await fetchStars(f)).toBe(4321);
    expect(await fetchStars(f)).toBe(4321);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("is null when GitHub refuses or answers oddly", async () => {
    expect(await fetchStars(reply({}, false))).toBeNull();
    expect(await fetchStars(reply({ stargazers_count: "lots" }))).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchStars(failing)).toBeNull();
  });
});
