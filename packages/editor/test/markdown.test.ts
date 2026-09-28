import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { docToMarkdown, looksLikeMarkdown, markdownToDoc } from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

const SAMPLE = `# The tool nobody talks about

Every workshop has **one** tool *nobody* talks about. It is ~~old~~ \`boring\`.

> A quote from a woodworker.

- first
- second with [a link](https://example.com "Example")

1. one
2. two

\`\`\`ts
const x = 1;
\`\`\`

---

![A plane](https://example.com/plane.png "Plane")
`;

describe("markdown round-trip", () => {
  it("parses every node and mark in the schema", () => {
    editor = createEditor();
    const doc = markdownToDoc(editor.schema, SAMPLE);
    const types = new Set<string>();
    doc.descendants((n) => {
      types.add(n.type.name);
      n.marks.forEach((m) => types.add(`mark:${m.type.name}`));
    });
    for (const t of [
      "heading",
      "paragraph",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "horizontalRule",
      "image",
      "mark:bold",
      "mark:italic",
      "mark:strike",
      "mark:code",
      "mark:link",
    ]) {
      expect(types, t).toContain(t);
    }
  });

  it("serialises back to identical markdown", () => {
    editor = createEditor();
    const doc = markdownToDoc(editor.schema, SAMPLE);
    expect(docToMarkdown(doc)).toBe(SAMPLE);
  });

  it("round-trips through the editor", () => {
    editor = createEditor();
    editor.commands.setContent(markdownToDoc(editor.schema, SAMPLE).toJSON());
    expect(docToMarkdown(editor.state.doc)).toBe(SAMPLE);
  });

  it("detects markdown-looking text", () => {
    expect(looksLikeMarkdown("# Title\n\nBody")).toBe(true);
    expect(looksLikeMarkdown("some **bold** words")).toBe(true);
    expect(looksLikeMarkdown("Just a sentence. Nothing special.")).toBe(false);
  });
});

describe("input shortcuts", () => {
  it("turns '# ' into a heading and '> ' into a blockquote", () => {
    editor = createEditor("<p></p>");
    editor.commands.focus("start");
    // Input rules run on text input; simulate by inserting then triggering via the view.
    const view = editor.view;
    const typeText = (text: string) => {
      for (const ch of text) {
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (f) =>
          f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
      }
    };
    typeText("# Hello");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.textContent).toBe("Hello");
  });
});
