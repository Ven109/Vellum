import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentStats } from "@vellum/core";
import { CurrentBlock, markdownToDoc, vellumExtensions } from "@vellum/editor";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { indexDocument } from "../data/search.js";
import { useApp } from "../state/app.js";
import { useCommentsBinding } from "../state/comments.js";
import { useSuggestionsBinding } from "../state/suggestions.js";
import { useDocSession } from "../state/session.js";
import type { HeadingEntry } from "../state/session.js";
import { SelectionToolbar } from "./SelectionToolbar.js";
import type { Editor } from "@tiptap/core";

interface Props {
  docId: string;
  ydoc: Y.Doc;
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

export function DocumentEditor({ docId, ydoc, initialMarkdown, primary = true }: Props) {
  const updateDocument = useApp((s) => s.updateDocument);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useEditor(
    {
      extensions: vellumExtensions({
        collaborative: true,
        extra: [Collaboration.configure({ document: ydoc, field: "content" }), CurrentBlock],
      }),
      editorProps: {
        attributes: { class: "vl-prose", "aria-label": "Document body", spellcheck: "true" },
      },
    },
    [ydoc],
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
  }, [editor, docId, initialMarkdown, updateDocument, primary]);

  useCommentsBinding(editor, ydoc, primary);
  useSuggestionsBinding(editor, primary);

  return (
    <>
      <EditorContent editor={editor} className="vl-editor" />
      {editor && <SelectionToolbar editor={editor} />}
    </>
  );
}
