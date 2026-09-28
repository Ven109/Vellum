import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { docTextMap } from "../src/index.js";
import { createEditor } from "./helpers.js";

let editor: Editor;
afterEach(() => editor?.destroy());

describe("docTextMap", () => {
  it("maps offsets and positions both ways across blocks", () => {
    editor = createEditor("<p>Hello <strong>bold</strong> world</p><p>Second para</p>");
    const map = docTextMap(editor.state.doc);
    expect(map.text).toBe("Hello bold world\n\nSecond para");
    const offset = map.text.indexOf("Second");
    const pos = map.posAt(offset);
    expect(editor.state.doc.textBetween(pos, pos + 6)).toBe("Second");
    expect(map.offsetAt(pos)).toBe(offset);
    const b = map.posAt(map.text.indexOf("bold"));
    expect(editor.state.doc.textBetween(b, b + 4)).toBe("bold");
  });
});
