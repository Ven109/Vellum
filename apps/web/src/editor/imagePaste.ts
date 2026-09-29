import type { EditorView } from "@tiptap/pm/view";
import { storeImage } from "../data/uploads.js";

const IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/;

export function imageFiles(dt: DataTransfer | null): File[] {
  return dt ? Array.from(dt.files).filter((f) => IMAGE.test(f.type)) : [];
}

/** Store each image (upload or embed) and insert it where it was pasted or dropped. */
export function insertImages(
  view: EditorView,
  files: File[],
  at?: number,
  onError?: (message: string) => void,
) {
  let pos = at ?? view.state.selection.from;
  for (const file of files) {
    storeImage(file).then(
      (src) => {
        if (view.isDestroyed) return;
        const node = view.state.schema.nodes.image!.create({ src, alt: file.name.replace(/\.[^.]+$/, "") });
        const insertAt = Math.min(pos, view.state.doc.content.size);
        view.dispatch(view.state.tr.insert(insertAt, node));
        pos = insertAt + node.nodeSize;
      },
      (e: unknown) => onError?.(e instanceof Error ? e.message : "Couldn't add that image."),
    );
  }
}

/** editorProps handlers for pasting and dropping image files. */
export const imageHandlers = {
  handlePaste(view: EditorView, event: ClipboardEvent) {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return false;
    insertImages(view, files);
    return true;
  },
  handleDrop(view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) {
    if (moved) return false;
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return false;
    event.preventDefault();
    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    insertImages(view, files, pos);
    return true;
  },
};
