import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "../src/index.js";

describe("fuzzy", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyMatch("wtnt", "Why the tool nobody talks")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Why the tool")).toBeNull();
    expect(fuzzyMatch("", "anything")?.score).toBe(0);
  });

  it("ranks prefixes and word starts above scattered matches", () => {
    const ranked = fuzzyRank(
      "tool",
      ["A stool pigeon", "Tools of the trade", "The quiet tool", "t o o l"],
      (s) => [s],
    );
    expect(ranked.map((r) => r.item)).toEqual([
      "Tools of the trade",
      "The quiet tool",
      "A stool pigeon",
      "t o o l",
    ]);
  });

  it("returns match indices for highlighting", () => {
    expect(fuzzyMatch("nd", "New draft")?.indices).toEqual([0, 4]);
  });

  it("ranks 10,000 documents in well under 50ms", () => {
    const words = [
      "essay",
      "notes",
      "draft",
      "workshop",
      "tool",
      "letter",
      "chapter",
      "review",
      "outline",
      "plan",
    ];
    const titles = Array.from(
      { length: 10_000 },
      (_, i) => `${words[i % 10]} ${words[(i * 7) % 10]} number ${i}`,
    );
    fuzzyRank("nts rev", titles, (s) => [s]); // warm up
    const start = performance.now();
    const ranked = fuzzyRank("nts rev", titles, (s) => [s]);
    const ms = performance.now() - start;
    expect(ranked.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
