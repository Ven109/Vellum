import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i if in into is it its of on or our she so that the their them then there they this to was we were what when which who will with you your".split(
    " ",
  ),
);

export interface RepeatedPhrase {
  phrase: string;
  from: number;
  to: number;
}

/**
 * Three-word phrases used more than once in the document (ignoring case and phrases made only of common
 * words). Returns every occurrence so each can be flagged.
 */
export function findRepeatedPhrases(doc: PMNode, maxWords = 60_000): RepeatedPhrase[] {
  const words: Array<{ w: string; from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Phrases don't span blocks: a gap entry breaks trigrams at paragraph boundaries.
    words.push({ w: "", from: pos, to: pos });
    node.forEach((child, offset) => {
      if (!child.isText) return;
      const text = child.text!;
      for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
        const from = pos + 1 + offset + m.index!;
        words.push({ w: m[0].toLowerCase().replace(/’/g, "'"), from, to: from + m[0].length });
      }
    });
    return false;
  });
  if (words.length > maxWords) return [];
  const seen = new Map<string, Array<{ from: number; to: number }>>();
  for (let i = 0; i + 2 < words.length; i++) {
    const [a, b, c] = [words[i]!, words[i + 1]!, words[i + 2]!];
    if (!a.w || !b.w || !c.w) continue;
    if (STOP.has(a.w) && STOP.has(b.w) && STOP.has(c.w)) continue;
    const key = `${a.w} ${b.w} ${c.w}`;
    const list = seen.get(key) ?? [];
    list.push({ from: a.from, to: c.to });
    seen.set(key, list);
  }
  const out: RepeatedPhrase[] = [];
  for (const [phrase, list] of seen) if (list.length > 1) for (const r of list) out.push({ phrase, ...r });
  return out;
}

export const repeatedPhrasesKey = new PluginKey<{ enabled: boolean; decorations: DecorationSet }>(
  "vellumRepeatedPhrases",
);

function decorate(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    findRepeatedPhrases(doc).map((r) =>
      Decoration.inline(r.from, r.to, { class: "vl-repeat", title: `Repeated phrase: “${r.phrase}”` }),
    ),
  );
}

/** Flags repeated phrasing with a subtle underline. Toggle with a `repeatedPhrasesKey` meta (boolean). */
export const RepeatedPhrases = Extension.create<{ enabled: boolean }>({
  name: "repeatedPhrases",
  addOptions() {
    return { enabled: false };
  },
  addProseMirrorPlugins() {
    const initial = this.options.enabled;
    return [
      new Plugin({
        key: repeatedPhrasesKey,
        state: {
          init: (_, state) => ({
            enabled: initial,
            decorations: initial ? decorate(state.doc) : DecorationSet.empty,
          }),
          apply(tr, value, _old, state) {
            const toggle = tr.getMeta(repeatedPhrasesKey) as boolean | undefined;
            const enabled = toggle ?? value.enabled;
            if (!enabled) return { enabled, decorations: DecorationSet.empty };
            if (toggle !== undefined || tr.docChanged) return { enabled, decorations: decorate(state.doc) };
            return value;
          },
        },
        props: {
          decorations(state) {
            return repeatedPhrasesKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});
