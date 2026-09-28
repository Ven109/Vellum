import { describe, expect, it } from "vitest";
import { countWords, documentStats, formatReadingTime } from "../src/index.js";

describe("countWords", () => {
  it("counts words, ignoring punctuation and whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords("Every workshop has one tool — nobody talks about it.")).toBe(9);
    expect(countWords("don't stop")).toBe(2);
  });
});

describe("documentStats", () => {
  it("counts characters and estimates reading time", () => {
    const s = documentStats("One two\nthree");
    expect(s).toEqual({ words: 3, characters: 12, charactersNoSpaces: 11, readingMinutes: 1 });
    expect(documentStats("").readingMinutes).toBe(0);
    expect(documentStats("word ".repeat(2380)).readingMinutes).toBe(10);
  });

  it("stays fast on long documents", () => {
    const text = "Every workshop has one tool nobody talks about. ".repeat(10_000); // 80k words
    const start = performance.now();
    const s = documentStats(text);
    const ms = performance.now() - start;
    expect(s.words).toBe(80_000);
    expect(ms).toBeLessThan(500);
  });

  it("formats reading time", () => {
    expect(formatReadingTime(0)).toBe("—");
    expect(formatReadingTime(7)).toBe("7 min read");
    expect(formatReadingTime(60)).toBe("1 h read");
    expect(formatReadingTime(75)).toBe("1 h 15 min read");
  });
});
