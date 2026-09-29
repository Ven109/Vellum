import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import type { Mark as PMMark, Node as PMNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

/**
 * Tracked suggestions. In suggesting mode, typing and deleting do not change the text: insertions are
 * added with a `suggestionInsert` mark and deletions keep the text with a `suggestionDelete` mark.
 * Because suggestions are marks in the document they sync through the CRDT like any other edit, and
 * their positions follow the text automatically. Accept/dismiss recompute ranges from the current
 * document for every suggestion, so accepting overlapping suggestions in any order cannot corrupt it.
 */
export interface SuggestionAttrs {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

const attrs = {
  id: { default: "" },
  authorId: { default: "" },
  authorName: { default: "" },
  createdAt: { default: "" },
};

const dataAttrs = (a: Record<string, unknown>) => ({
  "data-suggestion-id": a.id,
  "data-author": a.authorName,
  title: `Suggested by ${String(a.authorName || "someone")}`,
});

export const SuggestionInsert = Mark.create({
  name: "suggestionInsert",
  inclusive: false,
  addAttributes: () => attrs,
  parseHTML: () => [
    { tag: "ins[data-suggestion-id]", getAttrs: (el) => ({ id: (el as HTMLElement).dataset.suggestionId }) },
  ],
  renderHTML: ({ HTMLAttributes, mark }) => [
    "ins",
    mergeAttributes({ class: "vl-sug-ins" }, dataAttrs(mark.attrs), HTMLAttributes),
    0,
  ],
});

export const SuggestionDelete = Mark.create({
  name: "suggestionDelete",
  inclusive: false,
  addAttributes: () => attrs,
  parseHTML: () => [
    { tag: "del[data-suggestion-id]", getAttrs: (el) => ({ id: (el as HTMLElement).dataset.suggestionId }) },
  ],
  renderHTML: ({ HTMLAttributes, mark }) => [
    "del",
    mergeAttributes({ class: "vl-sug-del" }, dataAttrs(mark.attrs), HTMLAttributes),
    0,
  ],
});

export interface SuggestingState {
  enabled: boolean;
  author: { id: string; name: string };
}

export const suggestingKey = new PluginKey<SuggestingState>("vellumSuggesting");
/** Meta flag for transactions that must bypass suggesting mode (accept/reject, remote sync). */
export const SUGGESTION_INTERNAL = "vellumSuggestionInternal";

let seq = 0;
export function newSuggestionId(): string {
  return `sug_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isUserEdit(tr: Transaction): boolean {
  if (!tr.docChanged || tr.getMeta(SUGGESTION_INTERNAL)) return false;
  // Remote CRDT updates and history replays must apply as-is.
  if (tr.getMeta("y-sync$") || tr.getMeta("addToHistory") === false) return false;
  return tr.steps.every((s) => s instanceof ReplaceStep);
}

/**
 * Turn an edit that has just been applied into its suggestion form, in the same dispatch:
 * inserted text gets an insert-mark; deleted text is put back with a delete-mark (unless it was the
 * same author's own pending insertion, which really is removed). Struck text sits before the new text.
 */
function suggestionFor(
  oldState: EditorState,
  tr: Transaction,
  newState: EditorState,
  author: SuggestingState["author"],
): Transaction | null {
  const schema = newState.schema;
  const insType = schema.marks.suggestionInsert!;
  const delType = schema.marks.suggestionDelete!;
  const out = newState.tr;
  const id = newSuggestionId();
  const markAttrs: SuggestionAttrs = {
    id,
    authorId: author.id,
    authorName: author.name,
    createdAt: new Date().toISOString(),
  };
  let onlyDeletes = true;
  let deleteStart: number | null = null;
  let deleteEnd: number | null = null;

  tr.steps.forEach((raw, i) => {
    const step = raw as ReplaceStep & { from: number; to: number; slice: Slice };
    const docBefore = tr.docs[i]!;
    // Positions after step i (in the doc produced by this step), carried through later steps and `out`.
    const rest = tr.mapping.slice(i + 1);
    const toOut = (pos: number, assoc: number) => out.mapping.map(rest.map(pos, assoc), assoc);
    const insFrom = toOut(step.from, -1);
    const insTo = toOut(step.from + step.slice.size, 1);
    if (step.slice.size > 0) {
      onlyDeletes = false;
      // Continue the author's adjacent pending suggestion rather than starting a new one per keystroke.
      const $prev = out.doc.resolve(insFrom);
      const prevMark = $prev.nodeBefore?.marks.find(
        (m) => (m.type === insType || m.type === delType) && m.attrs.authorId === author.id,
      );
      const useAttrs =
        prevMark && prevMark.type === insType ? (prevMark.attrs as SuggestionAttrs) : markAttrs;
      if (prevMark && prevMark.type === delType && prevMark.attrs.id !== markAttrs.id) {
        // typing right after your own struck text: pair it with that deletion
        Object.assign(markAttrs, prevMark.attrs);
      }
      out.doc.nodesBetween(insFrom, insTo, (node, pos) => {
        if (node.isText) {
          const a = Math.max(insFrom, pos);
          const b = Math.min(insTo, pos + node.nodeSize);
          if (b > a) {
            out.removeMark(a, b, delType);
            out.addMark(a, b, insType.create(useAttrs));
          }
        }
        return true;
      });
    }
    if (step.to > step.from) {
      // Put back deleted text that wasn't the author's own pending insertion, marked as deleted.
      const pieces: Array<{ node: PMNode }> = [];
      docBefore.nodesBetween(step.from, step.to, (node, pos) => {
        if (!node.isText) return true;
        const a = Math.max(step.from, pos) - pos;
        const b = Math.min(step.to, pos + node.nodeSize) - pos;
        const own = node.marks.some((m) => m.type === insType && m.attrs.authorId === author.id);
        if (!own && b > a) pieces.push({ node: node.cut(a, b) });
        return false;
      });
      if (pieces.length) {
        const at = toOut(step.from, -1);
        // Extend the author's adjacent deletion (repeated Backspace/Delete) instead of a new one each time.
        const $at = out.doc.resolve(at);
        const near = [$at.nodeBefore, $at.nodeAfter]
          .flatMap((n) => n?.marks ?? [])
          .find((m) => m.type === delType && m.attrs.authorId === author.id);
        if (near) Object.assign(markAttrs, near.attrs);
        let pos = at;
        for (const { node } of pieces) {
          const alreadyDeleted = node.marks.find((m) => m.type === delType);
          const marked = alreadyDeleted ? node : node.mark(delType.create(markAttrs).addToSet(node.marks));
          out.insert(pos, marked);
          pos += marked.nodeSize;
        }
        deleteStart = deleteStart === null ? at : Math.min(deleteStart, at);
        deleteEnd = deleteEnd === null ? pos : Math.max(deleteEnd, pos);
      }
    }
  });
  if (!out.docChanged) return null;
  // Backspace/Delete: leave the cursor before the struck text so repeated presses keep striking.
  if (onlyDeletes && deleteStart !== null) {
    const first = tr.steps[0] as ReplaceStep & { from: number };
    // Forward delete (cursor was at the start of the removed range) moves past the struck text.
    const forward = oldState.selection.empty && oldState.selection.from === first.from;
    const target = forward && deleteEnd !== null ? deleteEnd : deleteStart;
    out.setSelection(TextSelection.create(out.doc, Math.min(target, out.doc.content.size)));
  }
  out.setMeta(SUGGESTION_INTERNAL, true);
  return out;
}

export interface SuggestionInfo {
  id: string;
  kind: "insert" | "delete" | "replace";
  authorId: string;
  authorName: string;
  createdAt: string;
  from: number;
  to: number;
  inserted: string;
  deleted: string;
}

/** All pending suggestions in document order. */
export function listSuggestions(doc: PMNode): SuggestionInfo[] {
  const byId = new Map<string, SuggestionInfo>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "suggestionInsert" && m.type.name !== "suggestionDelete") continue;
      const a = m.attrs as SuggestionAttrs;
      let info = byId.get(a.id);
      if (!info) {
        info = {
          id: a.id,
          kind: "insert",
          authorId: a.authorId,
          authorName: a.authorName,
          createdAt: a.createdAt,
          from: pos,
          to: pos,
          inserted: "",
          deleted: "",
        };
        byId.set(a.id, info);
      }
      info.from = Math.min(info.from, pos);
      info.to = Math.max(info.to, pos + node.nodeSize);
      if (m.type.name === "suggestionInsert") info.inserted += node.text;
      else info.deleted += node.text;
    }
    return false;
  });
  for (const s of byId.values())
    s.kind = s.inserted && s.deleted ? "replace" : s.inserted ? "insert" : "delete";
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

function rangesWith(doc: PMNode, markName: string, id: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m: PMMark) => m.type.name === markName && m.attrs.id === id)) {
      const last = out[out.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else out.push({ from: pos, to: pos + node.nodeSize });
    }
    return true;
  });
  return out;
}

/** Accept or dismiss suggestions, one transaction, ranges recomputed per suggestion. */
export function resolveSuggestions(
  state: EditorState,
  ids: string[],
  action: "accept" | "reject",
): Transaction {
  const tr = state.tr.setMeta(SUGGESTION_INTERNAL, true);
  const insType = state.schema.marks.suggestionInsert!;
  const delType = state.schema.marks.suggestionDelete!;
  for (const id of ids) {
    const keep = action === "accept" ? "suggestionInsert" : "suggestionDelete";
    const drop = action === "accept" ? "suggestionDelete" : "suggestionInsert";
    for (const r of rangesWith(tr.doc, keep, id))
      tr.removeMark(r.from, r.to, keep === "suggestionInsert" ? insType : delType);
    for (const r of rangesWith(tr.doc, drop, id).reverse()) tr.delete(r.from, r.to);
  }
  return tr;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestions: {
      setSuggesting: (enabled: boolean, author?: { id: string; name: string }) => ReturnType;
      acceptSuggestions: (ids: string[]) => ReturnType;
      rejectSuggestions: (ids: string[]) => ReturnType;
    };
  }
}

export function isSuggesting(state: EditorState): boolean {
  return suggestingKey.getState(state)?.enabled ?? false;
}

export const Suggestions = Extension.create({
  name: "suggestions",
  addExtensions() {
    return [SuggestionInsert, SuggestionDelete];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestingState>({
        key: suggestingKey,
        state: {
          init: () => ({ enabled: false, author: { id: "", name: "" } }),
          apply(tr, value) {
            const meta = tr.getMeta(suggestingKey) as SuggestingState | undefined;
            return meta ?? value;
          },
        },
        appendTransaction: (trs, oldState, newState) => {
          const st = suggestingKey.getState(newState);
          if (!st?.enabled || trs.length !== 1 || !isUserEdit(trs[0]!)) return null;
          return suggestionFor(oldState, trs[0]!, newState, st.author);
        },
      }),
    ];
  },
  addCommands() {
    return {
      setSuggesting:
        (enabled, author) =>
        ({ state, tr, dispatch }) => {
          const current = suggestingKey.getState(state)!;
          if (dispatch)
            tr.setMeta(suggestingKey, { enabled, author: author ?? current.author }).setMeta(
              "addToHistory",
              false,
            );
          return true;
        },
      acceptSuggestions:
        (ids) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolveSuggestions(state, ids, "accept"));
          return true;
        },
      rejectSuggestions:
        (ids) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(resolveSuggestions(state, ids, "reject"));
          return true;
        },
    };
  },
});
