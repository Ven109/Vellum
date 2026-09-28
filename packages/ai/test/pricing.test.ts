import { describe, expect, it } from "vitest";
import { costUsd, formatTokens, formatUsd, priceFor } from "../src/index.js";

describe("pricing", () => {
  it("prices known models, local models and overrides", () => {
    expect(priceFor("anthropic", "claude-opus-5-5")).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(priceFor("anthropic", "claude-opus-5-5-latest")).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(priceFor("ollama", "llama3.2")).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
    expect(priceFor("openai", "gpt-5")).toBeNull();
    expect(priceFor("openai", "gpt-5", { "gpt-5": { inputPerMTok: 1, outputPerMTok: 8 } })).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 8,
    });
  });

  it("computes and formats cost", () => {
    const c = costUsd({ inputTokens: 10_000, outputTokens: 2_000 }, { inputPerMTok: 4, outputPerMTok: 20 });
    expect(c).toBeCloseTo(0.08);
    expect(formatUsd(c)).toBe("$0.080");
    expect(formatUsd(0.001)).toBe("<$0.01");
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatTokens(1234)).toBe("1,234");
    expect(formatTokens(45_600)).toBe("45.6k");
  });
});
