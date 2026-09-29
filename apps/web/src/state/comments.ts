import type { Editor } from "@tiptap/core";
import type { CommentThread } from "@vellum/core";
import { useEffect } from "react";
import type * as Y from "yjs";
import { create } from "zustand";
import { resolveAnchor, saveAnchorState, threadsOf } from "../data/comments.js";
import type { Person } from "../data/comments.js";
import { useApp } from "./app.js";
import { useNotifications } from "./notifications.js";

interface CommentsState {
  doc: Y.Doc | null;
  threads: CommentThread[];
  positions: Record<string, { from: number; to: number } | null>;
  activeId: string | null;
  composing: { from: number; to: number } | null;
  setActive(id: string | null): void;
  startComposing(range: { from: number; to: number }): void;
  stopComposing(): void;
}

export const useComments = create<CommentsState>((set) => ({
  doc: null,
  threads: [],
  positions: {},
  activeId: null,
  composing: null,
  setActive(activeId) {
    set({ activeId });
  },
  startComposing(composing) {
    set({ composing, activeId: null });
  },
  stopComposing() {
    set({ composing: null });
  },
}));

/** People who can be @mentioned: workspace members plus anyone who has commented here. */
export function knownPeople(): Person[] {
  const user = useApp.getState().user;
  const people = new Map<string, Person>();
  if (user) people.set(user.id, { id: user.id, name: user.name });
  for (const m of useApp.getState().members ?? []) people.set(m.id, m);
  for (const t of useComments.getState().threads)
    for (const c of t.comments)
      if (c.authorName && !people.has(c.authorId))
        people.set(c.authorId, { id: c.authorId, name: c.authorName });
  return [...people.values()];
}

export function me(): Person {
  const u = useApp.getState().user;
  return { id: u?.id ?? "unknown", name: u?.name ?? "Someone" };
}

/**
 * Keeps comment anchors, editor highlights and the thread list in sync for the open document.
 * Positions are recomputed (debounced) after edits; moved anchors are re-saved and deleted ones are
 * marked orphaned, so every collaborator sees the same state.
 */
export function useCommentsBinding(editor: Editor | null, doc: Y.Doc | null, enabled: boolean) {
  useEffect(() => {
    if (!editor || !doc || !enabled) return;
    const map = threadsOf(doc);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;

    const recompute = (persist: boolean) => {
      const threads = [...map.values()];
      const positions: CommentsState["positions"] = {};
      for (const t of threads) {
        const r = resolveAnchor(editor, t.anchor);
        positions[t.id] = r ? { from: r.from, to: r.to } : null;
        if (persist) saveAnchorState(editor, doc, t, r);
      }
      threads.sort((a, b) => (positions[a.id]?.from ?? Infinity) - (positions[b.id]?.from ?? Infinity));
      useComments.setState({ threads, positions, doc });
      const active = useComments.getState().activeId;
      editor.commands.setAnnotations(
        threads
          .filter((t) => t.status === "open" && positions[t.id])
          .map((t) => ({
            id: t.id,
            kind: t.id === active ? ("comment-active" as const) : ("comment" as const),
            from: positions[t.id]!.from,
            to: positions[t.id]!.to,
          })),
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => recompute(false), 120);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => recompute(true), 1500);
    };

    recompute(false);
    const notify = () => useNotifications.getState().ingest(doc.guid, [...map.values()], me().id);
    notify();
    const onMap = () => {
      recompute(false);
      notify();
    };
    map.observe(onMap);
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) schedule();
    };
    editor.on("transaction", onTx);
    const unsubActive = useComments.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) recompute(false);
    });
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      const id = el?.dataset.annotationId;
      if (id && id.startsWith("thr_")) useComments.getState().setActive(id);
    };
    editor.view.dom.addEventListener("click", onClick);

    return () => {
      clearTimeout(timer);
      clearTimeout(persistTimer);
      map.unobserve(onMap);
      editor.off("transaction", onTx);
      unsubActive();
      editor.view.dom.removeEventListener("click", onClick);
      useComments.setState({ threads: [], positions: {}, doc: null, activeId: null, composing: null });
    };
  }, [editor, doc, enabled]);
}

if (import.meta.env.DEV && typeof window !== "undefined")
  (window as unknown as { __vellumComments: typeof useComments }).__vellumComments = useComments;
