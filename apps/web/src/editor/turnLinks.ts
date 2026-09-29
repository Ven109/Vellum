import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type * as Y from "yjs";
import { findTurn, observeConversation } from "../data/transcript.js";

const key = new PluginKey<DecorationSet>("vellumTurnLinks");

/**
 * Paragraphs written in a voice session say where they came from: hover one to see what was said.
 */
export function turnLinks(ydoc: Y.Doc) {
  return Extension.create({
    name: "turnLinks",
    addProseMirrorPlugins() {
      const build = (doc: PMNode) => {
        const decos: Decoration[] = [];
        doc.forEach((node, offset) => {
          const id = node.attrs.turnId as string | null | undefined;
          if (!id) return;
          const turn = findTurn(ydoc, id);
          const time = turn
            ? new Date(turn.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
            : "";
          decos.push(
            Decoration.node(offset, offset + node.nodeSize, {
              class: "vl-from-voice",
              title: turn
                ? `Written from what you said (${time}): “${turn.text}”`
                : "Written in a voice session",
            }),
          );
        });
        return DecorationSet.create(doc, decos);
      };
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_c, state) => build(state.doc),
            apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(key) ? build(state.doc) : old),
          },
          props: { decorations: (state) => key.getState(state) },
          view: (view) => {
            // Refresh when the transcript changes (it may arrive after the text).
            const off = observeConversation(ydoc, () => view.dispatch(view.state.tr.setMeta(key, true)));
            return { destroy: off };
          },
        }),
      ];
    },
  });
}
