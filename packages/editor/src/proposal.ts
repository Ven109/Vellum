import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffStats, diffWords } from "@vellum/core";
import { markdownToDoc } from "./markdown.js";

/**
 * A proposed rewrite of a range, shown as an inline word-level diff and never applied until accepted.
 * The range is mapped through every edit made while the proposal is open, so the writer can keep
 * typing elsewhere. Accept applies it as a single transaction (one undo step); discard leaves no trace.
 */
export interface ProposalState {
  id: string;
  from: number;
  to: number;
  original: string;
  proposed: string;
  streaming: boolean;
}

export const proposalKey = new PluginKey<ProposalState | null>("vellumProposal");

type Meta =
  | { type: "start"; proposal: ProposalState }
  | { type: "update"; proposed: string; streaming: boolean }
  | { type: "clear" };

/** Map offsets into `text` (as produced by textBetween(from, to, "\n\n")) back to document positions. */
function offsetMapper(doc: PMNode, from: number, to: number): (offset: number) => number {
  const segments: Array<{ offset: number; pos: number; len: number }> = [];
  let offset = 0;
  let first = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (!first) offset += 2; // the "\n\n" block separator
      first = false;
    }
    if (node.isText) {
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      segments.push({ offset, pos: start, len: end - start });
      offset += end - start;
    }
    return true;
  });
  return (o: number) => {
    for (const s of segments) if (o <= s.offset + s.len && o >= s.offset) return s.pos + (o - s.offset);
    const last = segments[segments.length - 1];
    return last ? last.pos + last.len : from;
  };
}

function decorations(state: EditorState, p: ProposalState): DecorationSet {
  const toPos = offsetMapper(state.doc, p.from, p.to);
  const decos: Decoration[] = [];
  const ops = p.streaming
    ? [
        { type: "delete" as const, text: p.original },
        { type: "insert" as const, text: p.proposed },
      ]
    : diffWords(p.original, p.proposed);
  let offset = 0;
  ops.forEach((op, i) => {
    if (op.type === "equal") {
      offset += op.text.length;
    } else if (op.type === "delete") {
      const a = toPos(offset);
      const b = toPos(offset + op.text.length);
      if (b > a) decos.push(Decoration.inline(a, b, { class: "vl-proposal-del" }, { proposal: p.id }));
      offset += op.text.length;
    } else if (op.text) {
      const at = toPos(offset);
      decos.push(
        Decoration.widget(
          at,
          () => {
            const el = document.createElement("span");
            el.className = `vl-proposal-ins${p.streaming ? " vl-streaming" : ""}`;
            el.textContent = op.text;
            return el;
          },
          { side: 1, key: `${p.id}-${i}-${op.text.length}`, proposal: p.id },
        ),
      );
    }
  });
  decos.push(Decoration.inline(p.from, p.to, { class: "vl-proposal-range" }, { proposal: p.id }));
  return DecorationSet.create(state.doc, decos);
}

/** Find `text` inside a single textblock, choosing the occurrence closest to `near`. */
export function relocate(doc: PMNode, text: string, near: number): { from: number; to: number } | null {
  if (!text || text.includes("\n")) return null;
  let best: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const content = node.textBetween(0, node.content.size, "\n", " ");
    for (let i = content.indexOf(text); i !== -1; i = content.indexOf(text, i + 1)) {
      // Only plain-text children keep offsets aligned with positions; check the slice matches.
      const from = pos + 1 + i;
      const to = from + text.length;
      if (doc.textBetween(from, to, "\n", " ") !== text) continue;
      if (!best || Math.abs(from - near) < Math.abs(best.from - near)) best = { from, to };
    }
    return false;
  });
  return best;
}

export function proposalPlugin(): Plugin<ProposalState | null> {
  return new Plugin<ProposalState | null>({
    key: proposalKey,
    state: {
      init: () => null,
      apply(tr: Transaction, value): ProposalState | null {
        const meta = tr.getMeta(proposalKey) as Meta | undefined;
        if (meta?.type === "start") return meta.proposal;
        if (meta?.type === "clear") return null;
        if (!value) return null;
        let next = value;
        if (tr.docChanged) {
          const from = tr.mapping.map(value.from, 1);
          const to = tr.mapping.map(value.to, -1);
          // If the proposed range itself was edited or deleted, the proposal no longer applies.
          const current = tr.doc.textBetween(from, Math.max(from, to), "\n\n", " ");
          if (to <= from || current !== value.original) {
            // A collaborative re-render replaces the whole document, which collapses mapped positions.
            // Find the untouched original text again, nearest to where it was.
            const found = relocate(tr.doc, value.original, from);
            if (!found) return null;
            next = { ...value, ...found };
          } else next = { ...value, from, to };
        }
        if (meta?.type === "update") next = { ...next, proposed: meta.proposed, streaming: meta.streaming };
        return next;
      },
    },
    props: {
      decorations(state) {
        const p = proposalKey.getState(state);
        return p ? decorations(state, p) : null;
      },
    },
  });
}

export function getProposal(state: EditorState): ProposalState | null {
  return proposalKey.getState(state) ?? null;
}

export function proposalStats(p: ProposalState): { added: number; removed: number } {
  return diffStats(diffWords(p.original, p.proposed));
}

let counter = 0;

/** Start a proposal over the current selection (or the given range). Returns the original text. */
export function startProposal(editor: Editor, range?: { from: number; to: number }): ProposalState | null {
  const { from, to } = range ?? editor.state.selection;
  if (from === to) return null;
  const original = editor.state.doc.textBetween(from, to, "\n\n", " ");
  const proposal: ProposalState = { id: `p${++counter}`, from, to, original, proposed: "", streaming: true };
  editor.view.dispatch(
    editor.state.tr.setMeta(proposalKey, { type: "start", proposal }).setMeta("addToHistory", false),
  );
  return proposal;
}

export function updateProposal(editor: Editor, proposed: string, streaming: boolean): void {
  if (!getProposal(editor.state)) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(proposalKey, { type: "update", proposed, streaming })
      .setMeta("addToHistory", false),
  );
}

export function discardProposal(editor: Editor): void {
  if (!getProposal(editor.state)) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(proposalKey, { type: "clear" }).setMeta("addToHistory", false),
  );
}

/**
 * Apply the proposal in one transaction. Multi-paragraph proposals are parsed as Markdown so structure
 * survives; single-paragraph proposals replace text inline, keeping surrounding marks.
 */
export function acceptProposal(editor: Editor): ProposalState | null {
  const p = getProposal(editor.state);
  if (!p || p.streaming) return null;
  const { state } = editor;
  let tr = state.tr;
  const multiBlock = /\n\s*\n/.test(p.proposed) || /\n\s*\n/.test(p.original);
  if (multiBlock) {
    const parsed = markdownToDoc(state.schema, p.proposed);
    const $from = state.doc.resolve(p.from);
    const $to = state.doc.resolve(p.to);
    const blockFrom = $from.before($from.depth);
    const blockTo = $to.after($to.depth);
    const whole = p.from <= $from.start() && p.to >= $to.end();
    if (whole) tr = tr.replaceWith(blockFrom, blockTo, parsed.content);
    else tr = tr.insertText(p.proposed.replace(/\n\s*\n/g, " "), p.from, p.to);
  } else {
    const marks = state.doc.resolve(p.from).marks();
    tr = tr.replaceWith(p.from, p.to, p.proposed ? state.schema.text(p.proposed, marks) : []);
  }
  tr.setMeta(proposalKey, { type: "clear" });
  editor.view.dispatch(tr);
  return p;
}

export const RewriteProposal = Extension.create({
  name: "rewriteProposal",
  addProseMirrorPlugins() {
    return [proposalPlugin()];
  },
});
