import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { docToMarkdown, listSuggestions } from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

const ann = { id: "usr_ann", name: "Ann" };
const bo = { id: "usr_bo", name: "Bo" };

function typeText(ed: Editor, text: string) {
  const view = ed.view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function find(ed: Editor, text: string) {
  let at = -1;
  ed.state.doc.descendants((n, p) => {
    if (at === -1 && n.isText && n.text!.includes(text)) at = p + n.text!.indexOf(text);
  });
  return at;
}

function backspace(ed: Editor) {
  const { from } = ed.state.selection;
  ed.view.dispatch(ed.state.tr.delete(from - 1, from));
}

const visible = (ed: Editor) => ed.state.doc.textContent;

describe("suggesting mode", () => {
  it("records typing as an insertion without affecting editing mode", () => {
    editor = createEditor("<p>Every tool.</p>");
    editor.commands.setSuggesting(true, ann);
    editor.commands.setTextSelection(find(editor, "tool"));
    typeText(editor, "quiet ");
    expect(visible(editor)).toBe("Every quiet tool.");
    const [s] = listSuggestions(editor.state.doc);
    expect(s).toMatchObject({ kind: "insert", inserted: "quiet ", authorName: "Ann" });
    expect(editor.getHTML()).toContain('<ins class="vl-sug-ins"');
  });

  it("keeps deleted text, struck through, and repeated backspace keeps striking", () => {
    editor = createEditor("<p>Every old tool.</p>");
    editor.commands.setSuggesting(true, ann);
    editor.commands.setTextSelection(find(editor, " tool"));
    for (let i = 0; i < 4; i++) backspace(editor);
    expect(visible(editor)).toBe("Every old tool.");
    const all = listSuggestions(editor.state.doc);
    expect(all.map((s) => s.deleted).join("")).toBe(" old");
    expect(all.every((s) => s.kind === "delete")).toBe(true);
  });

  it("replacing a selection becomes delete + insert, accepted as a unit", () => {
    editor = createEditor("<p>Every old tool.</p>");
    editor.commands.setSuggesting(true, ann);
    const at = find(editor, "old");
    editor.commands.setTextSelection({ from: at, to: at + 3 });
    typeText(editor, "new");
    let [s] = listSuggestions(editor.state.doc);
    expect(s).toMatchObject({ kind: "replace", deleted: "old" });
    expect(listSuggestions(editor.state.doc)).toHaveLength(1);
    editor.commands.acceptSuggestions(listSuggestions(editor.state.doc).map((x) => x.id));
    expect(visible(editor)).toBe("Every new tool.");
    expect(listSuggestions(editor.state.doc)).toEqual([]);
    s = listSuggestions(editor.state.doc)[0]!;
    expect(s).toBeUndefined();
  });

  it("deleting your own pending insertion removes it outright", () => {
    editor = createEditor("<p>Tool.</p>");
    editor.commands.setSuggesting(true, ann);
    editor.commands.setTextSelection(find(editor, "."));
    typeText(editor, "s");
    backspace(editor);
    expect(visible(editor)).toBe("Tool.");
    expect(listSuggestions(editor.state.doc)).toEqual([]);
  });

  it("rejecting restores the original; editing mode edits directly", () => {
    editor = createEditor("<p>Keep this text.</p>");
    editor.commands.setSuggesting(true, ann);
    const at = find(editor, "this");
    editor.commands.setTextSelection({ from: at, to: at + 4 });
    typeText(editor, "that");
    editor.commands.rejectSuggestions(listSuggestions(editor.state.doc).map((s) => s.id));
    expect(visible(editor)).toBe("Keep this text.");
    editor.commands.setSuggesting(false);
    editor.commands.setTextSelection(find(editor, "text"));
    typeText(editor, "the ");
    expect(visible(editor)).toBe("Keep this the text.");
    expect(listSuggestions(editor.state.doc)).toEqual([]);
  });

  it("accepting overlapping suggestions from two people in any order keeps the document valid", () => {
    for (const order of ["ann-first", "bo-first", "bulk"]) {
      editor = createEditor("<p>The quick brown fox.</p>");
      editor.commands.setSuggesting(true, ann);
      let at = find(editor, "quick brown");
      editor.commands.setTextSelection({ from: at, to: at + "quick brown".length });
      typeText(editor, "slow");
      const annIds = listSuggestions(editor.state.doc).map((s) => s.id);
      // Bo deletes a range that overlaps Ann's struck text and her insertion.
      editor.commands.setSuggesting(true, bo);
      at = find(editor, "brown");
      editor.commands.setTextSelection({ from: at, to: at + "brownslow".length });
      editor.view.dispatch(editor.state.tr.delete(at, at + "brownslow".length));
      const boIds = listSuggestions(editor.state.doc)
        .map((s) => s.id)
        .filter((id) => !annIds.includes(id));
      expect(boIds.length).toBeGreaterThan(0);

      if (order === "ann-first") {
        editor.commands.acceptSuggestions(annIds);
        editor.commands.acceptSuggestions(boIds);
      } else if (order === "bo-first") {
        editor.commands.acceptSuggestions(boIds);
        editor.commands.acceptSuggestions(annIds);
      } else {
        editor.commands.acceptSuggestions([...annIds, ...boIds]);
      }
      expect(listSuggestions(editor.state.doc)).toEqual([]);
      editor.state.doc.check();
      expect(visible(editor)).toBe("The  fox.");
      editor.destroy();
    }
  });

  it("serialises pending suggestions without markup", () => {
    editor = createEditor("<p>Tool.</p>");
    editor.commands.setSuggesting(true, ann);
    editor.commands.setTextSelection(find(editor, "."));
    typeText(editor, "s");
    expect(docToMarkdown(editor.state.doc)).toBe("Tools.\n");
  });
});
