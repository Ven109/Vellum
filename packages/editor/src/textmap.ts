import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Plain text of a document (blocks separated by blank lines) plus mappings between character offsets
 * in that text and ProseMirror positions. Used to re-anchor comments by quote.
 */
export interface TextMap {
  text: string;
  posAt(offset: number): number;
  offsetAt(pos: number): number;
}

export function docTextMap(doc: PMNode): TextMap {
  const segments: Array<{ offset: number; pos: number; len: number }> = [];
  let text = "";
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) text += "\n\n";
      first = false;
    }
    if (node.isText) {
      segments.push({ offset: text.length, pos, len: node.text!.length });
      text += node.text;
    }
    return true;
  });
  return {
    text,
    posAt(offset) {
      for (const s of segments)
        if (offset >= s.offset && offset <= s.offset + s.len) return s.pos + (offset - s.offset);
      const last = segments[segments.length - 1];
      return last ? last.pos + last.len : 0;
    },
    offsetAt(pos) {
      for (const s of segments) if (pos >= s.pos && pos <= s.pos + s.len) return s.offset + (pos - s.pos);
      let best = 0;
      for (const s of segments) if (s.pos <= pos) best = s.offset + s.len;
      return best;
    },
  };
}
