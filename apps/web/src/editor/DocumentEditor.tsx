import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import { countWords } from "@vellum/core";
import { markdownToDoc, vellumExtensions } from "@vellum/editor";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { useApp } from "../state/app.js";
import { useDocSession } from "../state/session.js";
import type { HeadingEntry } from "../state/session.js";
import { SelectionToolbar } from "./SelectionToolbar.js";
import type { Editor } from "@tiptap/core";

interface Props {
  docId: string;
  ydoc: Y.Doc;
  /** Markdown to seed an empty document with (used for the welcome draft). */
  initialMarkdown?: string;
}

function collectHeadings(editor: Editor): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading")
      out.push({ level: node.attrs.level as number, text: node.textContent, pos: offset });
  });
  return out;
}

export function DocumentEditor({ docId, ydoc, initialMarkdown }: Props) {
  const updateDocument = useApp((s) => s.updateDocument);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const editor = useEditor(
    {
      extensions: vellumExtensions({
        collaborative: true,
        extra: [Collaboration.configure({ document: ydoc, field: "content" })],
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
    const words = () => countWords(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " "));
    session.open(docId, editor, words());
    session.update({ headings: collectHeadings(editor) });
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const wordCount = words();
      session.update({ wordCount, headings: collectHeadings(editor) });
      clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(() => {
        void updateDocument(docId, { wordCount, updatedAt: new Date().toISOString() });
      }, 800);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      clearTimeout(metaTimer.current);
      session.close(docId);
    };
  }, [editor, docId, initialMarkdown, updateDocument]);

  return (
    <>
      <EditorContent editor={editor} className="vl-editor" />
      {editor && <SelectionToolbar editor={editor} />}
    </>
  );
}
