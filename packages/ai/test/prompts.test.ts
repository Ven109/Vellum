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

describe("house rules in outputs", () => {
  const rules = "- Use British spelling.\n2. No exclamation marks.\n\nSay “people”, not “users”.";

  it("numbers the rules and asks the model to report the ones that changed its output", async () => {
    const { buildSystemPrompt, houseRuleList } = await import("../src/prompts.js");
    expect(houseRuleList(rules)).toEqual([
      "Use British spelling.",
      "No exclamation marks.",
      "Say “people”, not “users”.",
    ]);
    const { system } = buildSystemPrompt({ documentTitle: "T", houseRules: rules });
    expect(system).toContain("1. Use British spelling.\n2. No exclamation marks.\n3. Say “people”");
    expect(system).toContain("[rules: 1, 3]");
  });

  it("extracts the rules line and hides a partial one while streaming", async () => {
    const { extractAppliedRules, hidePartialRulesMarker } = await import("../src/prompts.js");
    expect(extractAppliedRules("The colour of it.\n[rules: 1, 9, 1]", rules)).toEqual({
      text: "The colour of it.",
      applied: ["Use British spelling."],
    });
    expect(extractAppliedRules("No marker here.", rules)).toEqual({ text: "No marker here.", applied: [] });
    expect(hidePartialRulesMarker("Done.\n[ru")).toBe("Done.");
    expect(hidePartialRulesMarker("Done.\n[rules: 2")).toBe("Done.");
    expect(hidePartialRulesMarker("A [bracket] in text")).toBe("A [bracket] in text");
  });
});
