import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const currentBlockKey = new PluginKey("vellumCurrentBlock");

/**
 * Marks the top-level block holding the cursor with `vl-current-block`, so focus mode can dim the rest.
 * Only a class is added; the document is untouched.
 */
export const CurrentBlock = Extension.create({
  name: "currentBlock",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: currentBlockKey,
        props: {
          decorations(state) {
            const { $head } = state.selection;
            if ($head.depth < 1) return null;
            const from = $head.before(1);
            const node = state.doc.nodeAt(from);
            if (!node) return null;
            return DecorationSet.create(state.doc, [
              Decoration.node(from, from + node.nodeSize, { class: "vl-current-block" }),
            ]);
          },
        },
      }),
    ];
  },
});
