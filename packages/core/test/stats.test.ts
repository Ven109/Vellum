import { describe, expect, it } from "vitest";
import { countWords } from "../src/index.js";

describe("countWords", () => {
  it("counts words, ignoring punctuation and whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords("Every workshop has one tool — nobody talks about it.")).toBe(9);
    expect(countWords("don't stop")).toBe(2);
  });
});
