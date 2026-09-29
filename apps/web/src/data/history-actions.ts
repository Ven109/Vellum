import { getSchema } from "@tiptap/core";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type { Version } from "@vellum/core";
import { docToMarkdown, markdownToDoc, vellumExtensions } from "@vellum/editor";
import { useApp } from "../state/app.js";
import { createImportedDocs } from "./import-runner.js";
import { recordVersion } from "./versions.js";
import { acquireDoc, contentOf, releaseDoc, titleOf } from "./ydocs.js";

/**
 * Put an earlier version back. What's there now is saved as a version first, so a restore can itself be
 * undone from history. The restore is an ordinary edit, so it syncs to everyone in the document.
 */
export async function restoreVersion(docId: string, version: Version): Promise<void> {
  const user = useApp.getState().user;
  if (!user) return;
  const schema = getSchema(vellumExtensions());
  const live = acquireDoc(docId);
  try {
    await live.whenLoaded;
    const fragment = contentOf(live.doc);
    const title = titleOf(live.doc);
    const current = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    await recordVersion(
      docId,
      docToMarkdown(current),
      { kind: "user", userId: user.id },
      "checkpoint",
      undefined,
      title.toString(),
    );
    const restored = markdownToDoc(schema, version.markdown);
    live.doc.transact(() => {
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(restored, fragment);
      if (version.title !== undefined && version.title !== title.toString()) {
        title.delete(0, title.length);
        title.insert(0, version.title);
      }
    });
    live.remote?.flush();
    if (version.title !== undefined)
      await useApp
        .getState()
        .updateDocument(docId, { title: version.title, updatedAt: new Date().toISOString() });
    await recordVersion(
      docId,
      version.markdown,
      { kind: "user", userId: user.id },
      "restore",
      undefined,
      version.title,
    );
  } finally {
    releaseDoc(docId);
  }
}

/** Start a new draft from a version, leaving the original document untouched. */
export async function copyAsNewDraft(version: Version): Promise<string> {
  const [id] = await createImportedDocs(
    [
      {
        title: `${version.title || "Untitled"} (copy)`,
        markdown: version.markdown,
        folder: null,
        source: version.id,
      },
    ],
    undefined,
    "restore",
  );
  return id!;
}
