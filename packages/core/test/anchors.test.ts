import { describe, expect, it } from "vitest";
import { captureContext, parseMentions, reanchor } from "../src/index.js";

describe("anchors", () => {
  const text = "The tool is here. Later, the tool is there. Finally the tool rests.";

  it("re-finds a moved passage using its surrounding context", () => {
    const start = text.indexOf("the tool is there");
    const ctx = captureContext(text, start, start + "the tool".length);
    const edited = "Intro paragraph added. " + text.replace("Later,", "Much later,");
    const found = reanchor(edited, ctx)!;
    expect(edited.slice(found.start, found.end)).toBe("the tool");
    expect(edited.slice(found.end, found.end + 9)).toBe(" is there");
  });

  it("reports orphaned anchors", () => {
    expect(reanchor("nothing matches", { quote: "gone", prefix: "", suffix: "" })).toBeNull();
    expect(reanchor("anything", { quote: "", prefix: "", suffix: "" })).toBeNull();
  });

  it("parses mentions of known people", () => {
    const people = [
      { id: "u1", name: "Ann" },
      { id: "u2", name: "Ann Lee" },
      { id: "u3", name: "Bo" },
    ];
    expect(parseMentions("Thoughts @Ann Lee? cc @bo", people).sort()).toEqual(["u2", "u3"]);
    expect(parseMentions("email me at ann@example.com", people)).toEqual([]);
    expect(parseMentions("@Anne is not Ann", people)).toEqual([]);
  });
});
