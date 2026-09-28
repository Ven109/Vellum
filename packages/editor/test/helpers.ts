import { Editor } from "@tiptap/core";
import { vellumExtensions } from "../src/index.js";

export function createEditor(content = ""): Editor {
  return new Editor({ element: document.createElement("div"), extensions: vellumExtensions(), content });
}
