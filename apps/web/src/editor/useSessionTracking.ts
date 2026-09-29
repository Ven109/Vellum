import type { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { countWords, createId } from "@vellum/core";
import { useEffect } from "react";
import { useApp } from "../state/app.js";
import { ACTIVE_GAP_MS, IDLE_END_MS, useWriting } from "../state/writing.js";

const words = (editor: Editor) => {
  const doc = editor.state.doc;
  return countWords(doc.textBetween(0, doc.content.size, "\n", " "));
};

/**
 * Tracks writing sessions for the open document: a session starts with your first edit and ends after
 * five idle minutes, when you leave the document or when the tab is hidden. Only your own edits count.
 */
export function useSessionTracking(editor: Editor | null, docId: string, enabled: boolean) {
  useEffect(() => {
    if (!editor || !enabled) return;
    let current: { startedAt: number; startWords: number; last: number; activeMs: number } | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    // Running word count, so each edit's effect is known: other people's edits shift the session's
    // baseline instead of counting as yours.
    let lastCount = words(editor);

    const end = () => {
      clearTimeout(idleTimer);
      if (!current) return;
      const s = current;
      current = null;
      const added = Math.max(0, lastCount - s.startWords);
      const removed = Math.max(0, s.startWords - lastCount);
      if (!added && !removed) return;
      const user = useApp.getState().user;
      const collectionId = useApp.getState().documents.find((d) => d.id === docId)?.collectionId ?? null;
      void useWriting.getState().saveSession({
        id: createId("ses"),
        userId: user?.id ?? "",
        documentId: docId,
        collectionId,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: new Date(s.last).toISOString(),
        wordsAdded: added,
        wordsRemoved: removed,
        activeMs: s.activeMs,
      });
    };

    const onUpdate = ({
      transaction,
    }: {
      transaction: { docChanged: boolean; getMeta(k: unknown): unknown };
    }) => {
      if (!transaction.docChanged) return;
      const count = words(editor);
      const delta = count - lastCount;
      lastCount = count;
      const meta = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
      if (meta?.isChangeOrigin) {
        if (current) current.startWords += delta;
        return;
      }
      const now = Date.now();
      if (!current) {
        current = { startedAt: now, startWords: count - delta, last: now, activeMs: 0 };
      } else {
        current.activeMs += Math.min(now - current.last, ACTIVE_GAP_MS);
        current.last = now;
      }
      useWriting.setState({ liveWords: Math.max(0, count - current.startWords) });
      clearTimeout(idleTimer);
      idleTimer = setTimeout(end, IDLE_END_MS);
    };
    editor.on("update", onUpdate);
    const onHidden = () => document.visibilityState === "hidden" && end();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", end);
    return () => {
      end();
      editor.off("update", onUpdate);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", end);
    };
  }, [editor, docId, enabled]);
}
