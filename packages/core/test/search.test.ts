import { describe, expect, it } from "vitest";
import { SearchIndex, snippet, tokenize } from "../src/index.js";

function build() {
  const idx = new SearchIndex();
  idx.upsert({
    id: "a",
    title: "The quiet tool",
    body: "Every workshop has one tool nobody talks about. It is a marking gauge.",
  });
  idx.upsert({
    id: "b",
    title: "Café notes",
    body: "Espresso, crema and the workshop down the road. Tools everywhere.",
  });
  idx.upsert({ id: "c", title: "Unrelated", body: "Nothing to see here but gardening." });
  return idx;
}

describe("SearchIndex", () => {
  it("tokenizes with diacritics folded", () => {
    expect(tokenize("Café, don't STOP!")).toEqual(["cafe", "don't", "stop"]);
  });

  it("finds bodies and titles, ranking title hits higher", () => {
    const idx = build();
    const hits = idx.search("tool ");
    expect(hits.map((h) => h.id)).toEqual(["a"]);
    const prefix = idx.search("tool");
    expect(prefix.map((h) => h.id)).toEqual(["a", "b"]);
    expect(idx.search("cafe")[0]!.id).toBe("b");
  });

  it("requires every term to match", () => {
    const idx = build();
    expect(idx.search("workshop gauge").map((h) => h.id)).toEqual(["a"]);
    expect(idx.search("workshop gardening")).toEqual([]);
  });

  it("returns snippets around the hit", () => {
    const idx = build();
    expect(idx.search("marking")[0]!.snippet).toContain("marking gauge");
    expect(snippet("x ".repeat(200) + "needle here", ["needle"])).toMatch(/^….*needle here$/);
  });

  it("updates and removes documents", () => {
    const idx = build();
    idx.upsert({ id: "c", title: "Unrelated", body: "Now about a tool shed." });
    expect(idx.search("shed").map((h) => h.id)).toEqual(["c"]);
    expect(idx.search("gardening")).toEqual([]);
    idx.remove("a");
    expect(idx.search("gauge")).toEqual([]);
    expect(idx.size).toBe(2);
  });

  it("serialises round-trip", () => {
    const idx = SearchIndex.fromJSON(JSON.parse(JSON.stringify(build().toJSON())));
    expect(idx.search("espresso").map((h) => h.id)).toEqual(["b"]);
  });

  it("searches a large library quickly", () => {
    const idx = new SearchIndex();
    const words = "the quick brown fox jumps over lazy dog workshop tool essay chapter river mountain".split(
      " ",
    );
    for (let i = 0; i < 2000; i++) {
      const body =
        Array.from({ length: 300 }, (_, k) => words[(i * 31 + k * k + k * 3) % words.length]).join(" ") +
        ` unique${i}`;
      idx.upsert({ id: String(i), title: `Doc ${i}`, body });
    }
    const start = performance.now();
    const hits = idx.search("workshop riv");
    expect(performance.now() - start).toBeLessThan(50);
    expect(hits.length).toBeGreaterThan(0);
    expect(idx.search("unique1999")[0]!.id).toBe("1999");
  });
});
