import { turnLinks } from "./turnLinks.js";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentStats } from "@vellum/core";
import {
  CurrentBlock,
  RepeatedPhrases,
  markdownToDoc,
  repeatedPhrasesKey,
  vellumExtensions,
} from "@vellum/editor";
import { useEffect, useRef } from "react";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { indexDocument } from "../data/search.js";
import { useApp } from "../state/app.js";
import { usePreferences } from "../state/preferences.js";
import { useCommentsBinding } from "../state/comments.js";
import { useSuggestionsBinding } from "../state/suggestions.js";
import { useDocSession } from "../state/session.js";
import type { HeadingEntry } from "../state/session.js";
import { SelectionToolbar } from "./SelectionToolbar.js";
import { useSnapshots } from "./useSnapshots.js";
import { imageHandlers } from "./imagePaste.js";
import { useSessionTracking } from "./useSessionTracking.js";
import type { LiveDoc } from "../data/ydocs.js";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

interface Props {
  docId: string;
  ydoc: Y.Doc;
  /** Presence: shows other people's cursors and selections. */
  awareness?: Awareness;
  /** The live document, for history snapshots after merges. */
  live?: LiveDoc;
  /** Markdown to seed an empty document with (used for the welcome draft). */
  initialMarkdown?: string;
  /** The primary editor drives the top bar and right rail; a split pane does not. */
  primary?: boolean;
}

function collectHeadings(editor: Editor): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading")
      out.push({ level: node.attrs.level as number, text: node.textContent, pos: offset });
  });
  return out;
}

/** Other people's cursors and selections, labelled with their names. */
function presenceExtension(awareness: Awareness) {
  return Extension.create({
    name: "presence",
    addProseMirrorPlugins() {
      return [yCursorPlugin(awareness)];
    },
  });
}

export function DocumentEditor({ docId, ydoc, awareness, live, initialMarkdown, primary = true }: Props) {
  const updateDocument = useApp((s) => s.updateDocument);
  const flagRepeated = useApp((s) => s.workspace?.settings.behaviour.flagRepeatedPhrasing ?? false);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useEditor(
    {
      extensions: vellumExtensions({
        collaborative: true,
        extra: [
          Collaboration.configure({ document: ydoc, field: "content" }),
          CurrentBlock,
          RepeatedPhrases.configure({ enabled: flagRepeated }),
          turnLinks(ydoc),
          ...(awareness && primary ? [presenceExtension(awareness)] : []),
        ],
      }),
      editorProps: {
        ...imageHandlers,
        // tabindex keeps read-only documents focusable, so readers can select text to comment or ask.
        attributes: { class: "vl-prose", "aria-label": "Document body", spellcheck: "true", tabindex: "0" },
      },
    },
    [ydoc, awareness],
  );

  useEffect(() => {
    if (!editor) return;
    if (initialMarkdown && editor.isEmpty) {
      editor.commands.setContent(markdownToDoc(editor.schema, initialMarkdown).toJSON());
    }
    const session = useDocSession.getState();
    let lastText = "";
    const measure = () => {
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
      const stats = documentStats(text);
      lastText = text;
      if (primary) session.update({ stats, wordCount: stats.words, headings: collectHeadings(editor) });
      return stats;
    };
    if (primary) {
      session.open(docId, editor, 0);
      session.update({ awareness: awareness ?? null });
      useDocSession.setState({ openedWordCount: measure().words });
    }
    // Stats are recomputed at most every 200ms while typing so long documents stay responsive.
    let statsTimer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged || statsTimer) return;
      statsTimer = setTimeout(() => {
        statsTimer = undefined;
        const { words } = measure();
        clearTimeout(metaTimer.current);
        metaTimer.current = setTimeout(() => {
          void updateDocument(docId, { wordCount: words, updatedAt: new Date().toISOString() });
          const title = useApp.getState().documents.find((d) => d.id === docId)?.title ?? "";
          void indexDocument(docId, title, lastText);
        }, 600);
      }, 200);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      clearTimeout(statsTimer);
      clearTimeout(metaTimer.current);
      if (primary) session.close(docId);
    };
  }, [editor, docId, initialMarkdown, updateDocument, primary, awareness]);

  useCommentsBinding(editor, ydoc, primary);
  useSuggestionsBinding(editor, primary);
  useSnapshots(editor, docId, live ?? null, primary);
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta(repeatedPhrasesKey, flagRepeated));
  }, [editor, flagRepeated]);
  const spellcheck = usePreferences((s) => s.prefs.spellcheck);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dom.setAttribute("spellcheck", String(spellcheck));
  }, [editor, spellcheck]);
  useSessionTracking(editor, docId, primary);

  return (
    <>
      <EditorContent editor={editor} className="vl-editor" />
      {editor && <SelectionToolbar editor={editor} />}
    </>
  );
}
