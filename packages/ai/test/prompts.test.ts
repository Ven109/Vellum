import { describe, expect, it } from "vitest";
import { buildSystemPrompt, cleanRewrite, rewriteUserMessage } from "../src/index.js";

describe("prompts", () => {
  it("lists every attached source", () => {
    const p = buildSystemPrompt({
      documentTitle: "On workshops",
      selection: "one two three",
      houseRules: "Use British spelling.\nNo exclamation marks.",
      voiceTraits: ["Short sentences"],
    });
    expect(p.sources.map((s) => s.kind)).toEqual(["voice", "house-rules", "selection"]);
    expect(p.sources.find((s) => s.kind === "house-rules")?.detail).toBe("2 rules");
    expect(p.system).toContain("<selection>\none two three\n</selection>");
    expect(p.system).not.toContain("<document");
  });

  it("attaches the whole draft when asked", () => {
    const p = buildSystemPrompt({ documentTitle: 'A "quoted" title', document: "Body text here" });
    expect(p.system).toContain('<document title="A &quot;quoted&quot; title">');
    expect(p.sources).toEqual([
      { kind: "document", label: 'Whole draft: A "quoted" title', detail: "3 words" },
    ]);
  });

  it("builds rewrite requests and cleans replies", () => {
    expect(rewriteUserMessage("Tighten.", "x y")).toContain("<passage>\nx y\n</passage>");
    expect(cleanRewrite("Here is the tightened passage:\n\nShorter text.")).toBe("Shorter text.");
    expect(cleanRewrite("```\nFenced\n```")).toBe("Fenced");
    expect(cleanRewrite("“Quoted whole”")).toBe("Quoted whole");
    expect(cleanRewrite('He said "hi" then left.')).toBe('He said "hi" then left.');
  });
});
