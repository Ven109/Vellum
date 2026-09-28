import { describe, expect, it } from "vitest";
import { diffStats, diffWords, tokenizeForDiff } from "../src/index.js";

const apply = (ops: ReturnType<typeof diffWords>, side: "a" | "b") =>
  ops
    .filter((o) => o.type === "equal" || o.type === (side === "a" ? "delete" : "insert"))
    .map((o) => o.text)
    .join("");

describe("diffWords", () => {
  it("tokenizes losslessly", () => {
    const s = "Hello,  world! It's 3 o’clock.\n\nNew para.";
    expect(tokenizeForDiff(s).join("")).toBe(s);
  });

  it("finds word-level changes and reconstructs both sides", () => {
    const a = "Every workshop has one tool that nobody ever talks about.";
    const b = "Every workshop has a tool nobody talks about.";
    const ops = diffWords(a, b);
    expect(apply(ops, "a")).toBe(a);
    expect(apply(ops, "b")).toBe(b);
    expect(ops.filter((o) => o.type === "delete").map((o) => o.text.trim())).toContain("one");
    expect(diffStats(ops)).toEqual({ added: 1, removed: 3 });
  });

  it("handles empty sides and identical text", () => {
    expect(diffWords("", "new words")).toEqual([{ type: "insert", text: "new words" }]);
    expect(diffWords("old", "")).toEqual([{ type: "delete", text: "old" }]);
    expect(diffWords("same", "same")).toEqual([{ type: "equal", text: "same" }]);
  });

  it("stays fast on long texts", () => {
    const base = Array.from({ length: 3000 }, (_, i) => `word${i % 97}`).join(" ");
    const changed = base.replace(/word5 /g, "changed ");
    const start = performance.now();
    const ops = diffWords(base, changed);
    expect(performance.now() - start).toBeLessThan(500);
    expect(apply(ops, "b")).toBe(changed);
  });
});
