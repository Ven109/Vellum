import { getSchema } from "@tiptap/core";
import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import { countWords } from "@vellum/core";
import { markdownToDoc, vellumExtensions } from "@vellum/editor";
import { useApp } from "../state/app.js";
import type { ImportedDoc } from "./importers.js";
import { indexDocument } from "./search.js";
import { acquireDoc, contentOf, releaseDoc, titleOf } from "./ydocs.js";

/**
 * Create a draft per imported document. Folders become collections (reusing one with the same name).
 * Content is written straight into each document's Y.Doc, so it saves and syncs like typed text.
 */
export async function createImportedDocs(
  docs: ImportedDoc[],
  onProgress?: (done: number) => void,
): Promise<string[]> {
  const app = useApp.getState();
  const schema = getSchema(vellumExtensions());
  const collections = new Map(app.collections.map((c) => [c.name.toLowerCase(), c.id]));
  const ids: string[] = [];
  for (const [i, item] of docs.entries()) {
    let collectionId: string | null = null;
    if (item.folder) {
      const key = item.folder.toLowerCase();
      collectionId = collections.get(key) ?? null;
      if (!collectionId) {
        collectionId = (await useApp.getState().createCollection(item.folder.slice(0, 60))).id;
        collections.set(key, collectionId);
      }
    }
    const meta = await useApp.getState().createDocument({ title: item.title.slice(0, 300), collectionId });
    const live = acquireDoc(meta.id);
    try {
      await live.whenLoaded;
      const pmDoc = markdownToDoc(schema, item.markdown);
      live.doc.transact(() => {
        titleOf(live.doc).insert(0, meta.title);
        prosemirrorToYXmlFragment(pmDoc, contentOf(live.doc));
      });
      live.remote?.flush();
      const text = pmDoc.textBetween(0, pmDoc.content.size, "\n", " ");
      await useApp.getState().updateDocument(meta.id, { wordCount: countWords(text) });
      void indexDocument(meta.id, meta.title, text);
    } finally {
      releaseDoc(meta.id);
    }
    ids.push(meta.id);
    onProgress?.(i + 1);
  }
  return ids;
}
