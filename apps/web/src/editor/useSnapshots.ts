import type { Editor } from "@tiptap/core";
import { yXmlFragmentToProseMirrorRootNode, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { AGENT_META, docToMarkdown } from "@vellum/editor";
import { useEffect } from "react";
import { recordVersion } from "../data/versions.js";
import { contentOf } from "../data/ydocs.js";
import type { LiveDoc } from "../data/ydocs.js";
import { useApp } from "../state/app.js";

/** How often a document being edited gets an automatic snapshot. */
export const SNAPSHOT_EVERY_MS = 5 * 60_000;

/**
 * Automatic history for the open document. A snapshot is taken every few minutes while you're editing,
 * when you leave the document or the tab, when its status changes, and after edits from elsewhere were
 * merged. Only your own edits trigger snapshots, so each version is attributed to the person who made it
 * (collaborators' clients snapshot their own work).
 */
export function useSnapshots(editor: Editor | null, docId: string, live: LiveDoc | null, enabled: boolean) {
  useEffect(() => {
    if (!editor || !enabled) return;
    let dirty = false;
    let busy = false;

    const snapshot = async (reason: "autosave" | "checkpoint", force = false) => {
      if ((!dirty && !force) || busy) return;
      const user = useApp.getState().user;
      if (!user) return;
      busy = true;
      dirty = false;
      try {
        await recordVersion(
          docId,
          docToMarkdown(editor.state.doc),
          { kind: "user", userId: user.id },
          reason,
        );
      } catch {
        dirty = true;
      } finally {
        busy = false;
      }
    };

    const onUpdate = ({
      transaction,
    }: {
      transaction: { docChanged: boolean; getMeta(k: unknown): unknown };
    }) => {
      if (!transaction.docChanged) return;
      const meta = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
      if (meta?.isChangeOrigin) return; // someone else's edit, or the initial load
      if (transaction.getMeta(AGENT_META)) return; // the voice agent's writing gets its own versions
      dirty = true;
    };
    editor.on("update", onUpdate);

    const timer = setInterval(() => void snapshot("autosave"), SNAPSHOT_EVERY_MS);
    const onHidden = () => document.visibilityState === "hidden" && void snapshot("autosave");
    document.addEventListener("visibilitychange", onHidden);

    let status = useApp.getState().documents.find((d) => d.id === docId)?.status;
    const unsubStatus = useApp.subscribe((s) => {
      const next = s.documents.find((d) => d.id === docId)?.status;
      if (next && status && next !== status) void snapshot("checkpoint", true);
      status = next;
    });

    const unsubMerged = live?.onMerged((before) => {
      const user = useApp.getState().user;
      const merged = docToMarkdown(editor.state.doc);
      // Keep what this device had before the merge as a named version, so offline work is never lost
      // even if the automatic merge interleaved it with someone else's changes.
      if (before.length && user) {
        const snapshot = new Y.Doc();
        Y.applyUpdate(snapshot, before);
        const offline = docToMarkdown(yXmlFragmentToProseMirrorRootNode(contentOf(snapshot), editor.schema));
        snapshot.destroy();
        if (offline !== merged)
          void recordVersion(
            docId,
            offline,
            { kind: "user", userId: user.id },
            "sync-conflict",
            "Your offline edits, before merging",
          ).catch(() => undefined);
      }
      void recordVersion(
        docId,
        merged,
        { kind: "system", reason: "Merged edits made elsewhere while offline" },
        "sync-conflict",
      ).catch(() => undefined);
    });

    return () => {
      void snapshot("autosave");
      editor.off("update", onUpdate);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      unsubStatus();
      unsubMerged?.();
    };
  }, [editor, docId, live, enabled]);
}
