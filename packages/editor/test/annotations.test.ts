import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { getAnnotations } from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

describe("annotations", () => {
  it("renders decorations without changing the document", () => {
    editor = createEditor("<p>Every workshop has one tool.</p>");
    const before = editor.getJSON();
    editor.commands.setAnnotations([
      { id: "c1", kind: "comment", from: 7, to: 15 },
      { id: "s1", kind: "suggestion-insert", from: 20, to: 20, widget: " quiet" },
    ]);
    expect(editor.getJSON()).toEqual(before);
    const html = editor.view.dom.innerHTML;
    expect(html).toContain('class="vl-annotation vl-comment"');
    expect(html).toContain("vl-suggestion-insert-widget");
    expect(html).toContain(" quiet");
  });

  it("maps annotation positions through edits", () => {
    editor = createEditor("<p>Every workshop has one tool.</p>");
    editor.commands.addAnnotation({ id: "c1", kind: "comment", from: 7, to: 15 });
    editor.commands.insertContentAt(1, "Honestly, ");
    const [a] = getAnnotations(editor.state);
    expect(editor.state.doc.textBetween(a!.from, a!.to)).toBe("workshop");
  });

  it("removes and clears annotations", () => {
    editor = createEditor("<p>Hello world</p>");
    editor.commands.addAnnotation({ id: "a", kind: "ai-highlight", from: 1, to: 6 });
    editor.commands.addAnnotation({ id: "b", kind: "comment", from: 7, to: 12 });
    editor.commands.removeAnnotation("a");
    expect(getAnnotations(editor.state).map((x) => x.id)).toEqual(["b"]);
    editor.commands.clearAnnotations();
    expect(getAnnotations(editor.state)).toEqual([]);
  });

  it("does not add annotation changes to undo history", () => {
    editor = createEditor("<p>Hello</p>");
    editor.commands.insertContentAt(6, " there");
    editor.commands.addAnnotation({ id: "a", kind: "comment", from: 1, to: 6 });
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("Hello");
  });
});
