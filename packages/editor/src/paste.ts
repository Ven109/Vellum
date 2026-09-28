import { Extension } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { looksLikeMarkdown, markdownToDoc } from "./markdown.js";

/**
 * Paste handling: when the clipboard only has plain text and it looks like Markdown, parse it into rich
 * content instead of inserting literal `#` and `**`. HTML pastes go through ProseMirror's normal parser,
 * which the schema already sanitises to the nodes and marks we support.
 */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("vellumMarkdownPaste"),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || data.types.includes("text/html")) return false;
            const text = data.getData("text/plain");
            if (!text || !looksLikeMarkdown(text)) return false;
            const doc = markdownToDoc(view.state.schema, text);
            view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
