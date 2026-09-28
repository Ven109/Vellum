import { describe, expect, it } from "vitest";
import { measureVoice, mergeTraits, traitsFromStats } from "../src/index.js";

const terse = Array.from(
  { length: 30 },
  (_, i) =>
    `The workshop was quiet. I sharpened the chisel. It took time. The grain fought back, and I let it. Wood teaches patience ${i}.`,
).join("\n\n");

const florid = Array.from(
  { length: 20 },
  () =>
    `Honestly, the workshop was incredibly quiet that morning — the kind of quiet that settles slowly into the rafters, gently and completely, while the light moves carefully across the bench; it really is extraordinarily beautiful, isn't it?`,
).join("\n\n");

describe("voice learning", () => {
  it("returns nothing for too little text", () => {
    expect(measureVoice(["Too short to learn from."])).toBeNull();
  });

  it("learns a terse, first-person voice", () => {
    const stats = measureVoice([terse])!;
    expect(stats.avgSentenceWords).toBeLessThan(8);
    const traits = traitsFromStats(stats);
    const ids = traits.map((t) => t.id);
    expect(ids).toContain("sentence-length");
    expect(traits.find((t) => t.id === "sentence-length")!.label).toBe("Short sentences");
    expect(ids).toContain("person");
    expect(traits.find((t) => t.id === "exclamations")).toBeTruthy();
    expect(traits.find((t) => t.id === "vocabulary")?.instruction).toContain("chisel");
  });

  it("learns a florid voice with adverbs, dashes and semicolons", () => {
    const stats = measureVoice([florid])!;
    expect(stats.adverbsPer100).toBeGreaterThan(2.5);
    const traits = traitsFromStats(stats);
    expect(traits.find((t) => t.id === "sentence-length")!.label).toBe("Long, flowing sentences");
    expect(traits.map((t) => t.label)).toEqual(
      expect.arrayContaining(["Adverb-friendly", "Uses em dashes", "Uses semicolons"]),
    );
  });

  it("ignores markdown syntax", () => {
    const md = `# Title\n\n${terse}\n\n\`\`\`\ncode; with; semicolons; ;;;; ;;;;\n\`\`\``;
    expect(measureVoice([md])!.semicolonsPer1000).toBe(0);
  });

  it("keeps the writer's edits and deletions when re-learning", () => {
    const learned = traitsFromStats(measureVoice([terse])!);
    const existing = learned.map((t) =>
      t.id === "sentence-length"
        ? { ...t, instruction: "My own wording." }
        : t.id === "person"
          ? { ...t, enabled: false }
          : t,
    );
    existing.push({
      id: "custom-1",
      label: "British spelling",
      instruction: "Use British spelling.",
      enabled: true,
    });
    const merged = mergeTraits(learned, existing, new Set(["sentence-length"]), new Set(["exclamations"]));
    expect(merged.find((t) => t.id === "sentence-length")!.instruction).toBe("My own wording.");
    expect(merged.find((t) => t.id === "person")!.enabled).toBe(false);
    expect(merged.find((t) => t.id === "exclamations")).toBeUndefined();
    expect(merged.find((t) => t.id === "custom-1")).toBeTruthy();
  });
});
