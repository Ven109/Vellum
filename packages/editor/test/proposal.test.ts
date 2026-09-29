import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  acceptProposal,
  discardProposal,
  getProposal,
  proposalStats,
  startProposal,
  updateProposal,
} from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

function select(ed: Editor, text: string) {
  const full = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n\n", " ");
  let pos = -1;
  ed.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text!.includes(text)) pos = p + node.text!.indexOf(text);
  });
  expect(full).toContain(text);
  ed.commands.setTextSelection({ from: pos, to: pos + text.length });
}

describe("rewrite proposals", () => {
  it("shows a diff without touching the document, then accepts as one undo step", () => {
    editor = createEditor("<p>Every workshop has one tool that nobody ever talks about.</p>");
    const before = editor.getJSON();
    select(editor, "one tool that nobody ever talks about");
    startProposal(editor);
    updateProposal(editor, "a tool nobody talks", true);
    updateProposal(editor, "a tool nobody talks about", false);
    expect(editor.getJSON()).toEqual(before);
    const html = editor.view.dom.innerHTML;
    expect(html).toContain("vl-proposal-del");
    expect(html).toContain("vl-proposal-ins");
    expect(proposalStats(getProposal(editor.state)!)).toEqual({ added: 1, removed: 3 });

    acceptProposal(editor);
    expect(editor.state.doc.textContent).toBe("Every workshop has a tool nobody talks about.");
    expect(getProposal(editor.state)).toBeNull();
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("Every workshop has one tool that nobody ever talks about.");
  });

  it("discard leaves no trace", () => {
    editor = createEditor("<p>Keep me as I am.</p>");
    const before = editor.getJSON();
    select(editor, "as I am");
    startProposal(editor);
    updateProposal(editor, "unchanged", false);
    discardProposal(editor);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.view.dom.innerHTML).not.toContain("vl-proposal");
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(before);
  });

  it("follows edits elsewhere and drops the proposal if its text changes", () => {
    editor = createEditor("<p>First sentence.</p><p>Second sentence here.</p>");
    select(editor, "Second sentence here.");
    startProposal(editor);
    updateProposal(editor, "Second line.", false);
    editor.commands.insertContentAt(1, "Very ");
    expect(getProposal(editor.state)).not.toBeNull();
    acceptProposal(editor);
    expect(editor.state.doc.textContent).toBe("Very First sentence.Second line.");

    select(editor, "Second line.");
    startProposal(editor);
    editor.commands.insertContentAt(editor.state.selection.from + 2, "X");
    expect(getProposal(editor.state)).toBeNull();
  });

  it("keeps marks around a single-paragraph replacement", () => {
    editor = createEditor("<p><strong>bold words here</strong></p>");
    select(editor, "words");
    startProposal(editor);
    updateProposal(editor, "phrases", false);
    acceptProposal(editor);
    expect(editor.getHTML()).toBe("<p><strong>bold phrases here</strong></p>");
  });

  it("replaces whole paragraphs with multi-paragraph proposals", () => {
    editor = createEditor("<p>One.</p><p>Two.</p><p>Three.</p>");
    const from = 1;
    const twoEnd = (() => {
      let end = 0;
      editor.state.doc.descendants((n, p) => {
        if (n.isText && n.text === "Two.") end = p + 4;
      });
      return end;
    })();
    editor.commands.setTextSelection({ from, to: twoEnd });
    startProposal(editor);
    updateProposal(editor, "Uno.\n\nDos.\n\nAnd a new one.", false);
    acceptProposal(editor);
    expect(editor.getHTML()).toBe("<p>Uno.</p><p>Dos.</p><p>And a new one.</p><p>Three.</p>");
  });
});

describe("relocate", () => {
  it("finds the original text nearest the old position", async () => {
    const { relocate } = await import("../src/proposal.js");
    const { getSchema } = await import("@tiptap/core");
    const { vellumExtensions } = await import("../src/extensions.js");
    const schema = getSchema(vellumExtensions());
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("one two one")]),
      schema.node("paragraph", null, [schema.text("three one")]),
    ]);
    expect(relocate(doc, "one", 0)).toEqual({ from: 1, to: 4 });
    expect(relocate(doc, "one", 9)).toEqual({ from: 9, to: 12 });
    expect(relocate(doc, "one", 20)).toEqual({ from: 20, to: 23 });
    expect(relocate(doc, "missing", 0)).toBeNull();
    expect(relocate(doc, "a\nb", 0)).toBeNull();
  });
});

describe("current block", () => {
  it("marks only the top-level block with the cursor", async () => {
    const { Editor } = await import("@tiptap/core");
    const { CurrentBlock } = await import("../src/focus.js");
    const { vellumExtensions } = await import("../src/extensions.js");
    const editor = new Editor({
      extensions: vellumExtensions({ extra: [CurrentBlock] }),
      content: "<p>one</p><blockquote><p>two</p></blockquote><p>three</p>",
    });
    editor.commands.setTextSelection(8);
    const marked = editor.view.dom.querySelectorAll(".vl-current-block");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.tagName).toBe("BLOCKQUOTE");
    editor.destroy();
  });
});

describe("repeated phrases", () => {
  it("flags three-word phrases used more than once, within blocks only", async () => {
    const { Editor } = await import("@tiptap/core");
    const { findRepeatedPhrases, repeatedPhrasesKey, RepeatedPhrases } = await import("../src/repeated.js");
    const { vellumExtensions } = await import("../src/extensions.js");
    const editor = new Editor({
      extensions: vellumExtensions({ extra: [RepeatedPhrases] }),
      content:
        "<p>At the end of the day we shipped it.</p><p>At the end of the day, nobody cared.</p><p>of the day</p><p>it is in the</p><p>it is in the</p>",
    });
    const phrases = new Set(findRepeatedPhrases(editor.state.doc).map((r) => r.phrase));
    expect(phrases).toEqual(new Set(["at the end", "the end of", "end of the", "of the day"]));
    // "of the day" is flagged in all three blocks; stop-word-only phrases are ignored.
    expect(findRepeatedPhrases(editor.state.doc).filter((r) => r.phrase === "of the day")).toHaveLength(3);

    expect(editor.view.dom.querySelectorAll(".vl-repeat")).toHaveLength(0);
    editor.view.dispatch(editor.state.tr.setMeta(repeatedPhrasesKey, true));
    expect(editor.view.dom.querySelectorAll(".vl-repeat").length).toBeGreaterThan(0);
    editor.view.dispatch(editor.state.tr.setMeta(repeatedPhrasesKey, false));
    expect(editor.view.dom.querySelectorAll(".vl-repeat")).toHaveLength(0);
    editor.destroy();
  });
});
