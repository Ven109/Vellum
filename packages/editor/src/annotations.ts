import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Kinds of inline annotation the editor can render. Comments, tracked suggestions, AI rewrite proposals
 * and agent streaming all show up as decorations — they never mutate the document by themselves.
 */
export type AnnotationKind =
  "comment" | "comment-active" | "suggestion-insert" | "suggestion-delete" | "ai-highlight" | "agent-writing";

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  from: number;
  to: number;
  /** Optional widget text rendered after `to` (used for suggestion insertions not yet in the doc). */
  widget?: string;
  attrs?: Record<string, string>;
}

type Meta =
  | { type: "set"; annotations: Annotation[] }
  | { type: "add"; annotation: Annotation }
  | { type: "remove"; id: string }
  | { type: "clear" };

interface PluginState {
  set: DecorationSet;
}

export const annotationsKey = new PluginKey<PluginState>("vellumAnnotations");

function toDecorations(annotation: Annotation): Decoration[] {
  const spec = { id: annotation.id, kind: annotation.kind };
  const attrs = {
    class: `vl-annotation vl-${annotation.kind}`,
    "data-annotation-id": annotation.id,
    ...annotation.attrs,
  };
  const decos: Decoration[] = [];
  if (annotation.to > annotation.from)
    decos.push(Decoration.inline(annotation.from, annotation.to, attrs, spec));
  if (annotation.widget) {
    const text = annotation.widget;
    decos.push(
      Decoration.widget(
        annotation.to,
        () => {
          const el = document.createElement("span");
          el.className = `vl-annotation vl-${annotation.kind}-widget`;
          el.dataset.annotationId = annotation.id;
          el.textContent = text;
          return el;
        },
        { ...spec, side: 1 },
      ),
    );
  }
  return decos;
}

function clamp(a: Annotation, size: number): Annotation {
  const from = Math.max(0, Math.min(a.from, size));
  const to = Math.max(from, Math.min(a.to, size));
  return { ...a, from, to };
}

export function annotationsPlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: annotationsKey,
    state: {
      init: () => ({ set: DecorationSet.empty }),
      apply(tr: Transaction, value: PluginState, _old: EditorState, state: EditorState): PluginState {
        let set = value.set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(annotationsKey) as Meta | undefined;
        if (meta) {
          const size = state.doc.content.size;
          if (meta.type === "set") {
            set = DecorationSet.create(
              state.doc,
              meta.annotations.flatMap((a) => toDecorations(clamp(a, size))),
            );
          } else if (meta.type === "add") {
            set = set.remove(set.find(undefined, undefined, (s) => s.id === meta.annotation.id));
            set = set.add(state.doc, toDecorations(clamp(meta.annotation, size)));
          } else if (meta.type === "remove") {
            set = set.remove(set.find(undefined, undefined, (s) => s.id === meta.id));
          } else {
            set = DecorationSet.empty;
          }
        }
        return { set };
      },
    },
    props: {
      decorations(state) {
        return annotationsKey.getState(state)?.set;
      },
    },
  });
}

/** Current positions of all annotations, after mapping through every edit since they were added. */
export function getAnnotations(
  state: EditorState,
): Array<{ id: string; kind: AnnotationKind; from: number; to: number }> {
  const set = annotationsKey.getState(state)?.set;
  if (!set) return [];
  const byId = new Map<string, { id: string; kind: AnnotationKind; from: number; to: number }>();
  for (const d of set.find()) {
    const spec = d.spec as { id: string; kind: AnnotationKind };
    const existing = byId.get(spec.id);
    if (existing) {
      existing.from = Math.min(existing.from, d.from);
      existing.to = Math.max(existing.to, d.to);
    } else byId.set(spec.id, { id: spec.id, kind: spec.kind, from: d.from, to: d.to });
  }
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    annotations: {
      setAnnotations: (annotations: Annotation[]) => ReturnType;
      addAnnotation: (annotation: Annotation) => ReturnType;
      removeAnnotation: (id: string) => ReturnType;
      clearAnnotations: () => ReturnType;
    };
  }
}

export const Annotations = Extension.create({
  name: "annotations",
  addProseMirrorPlugins() {
    return [annotationsPlugin()];
  },
  addCommands() {
    const dispatchMeta =
      (meta: Meta) =>
      () =>
      ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        if (dispatch) tr.setMeta(annotationsKey, meta).setMeta("addToHistory", false);
        return true;
      };
    return {
      setAnnotations: (annotations: Annotation[]) => dispatchMeta({ type: "set", annotations })(),
      addAnnotation: (annotation: Annotation) => dispatchMeta({ type: "add", annotation })(),
      removeAnnotation: (id: string) => dispatchMeta({ type: "remove", id })(),
      clearAnnotations: () => dispatchMeta({ type: "clear" })(),
    };
  },
});
