import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/**
 * One live Y.Doc per open document, persisted locally in IndexedDB. The Y.Doc is the single source of
 * truth for document content (ADR 0001): `content` is the ProseMirror fragment and `title` the title.
 */
export interface LiveDoc {
  id: string;
  doc: Y.Doc;
  persistence: IndexeddbPersistence;
  whenLoaded: Promise<void>;
  refs: number;
}

const live = new Map<string, LiveDoc>();

export function acquireDoc(id: string): LiveDoc {
  let entry = live.get(id);
  if (!entry) {
    const doc = new Y.Doc({ guid: id });
    const persistence = new IndexeddbPersistence(`vellum-doc-${id}`, doc);
    entry = {
      id,
      doc,
      persistence,
      whenLoaded: persistence.whenSynced.then(() => undefined),
      refs: 0,
    };
    live.set(id, entry);
  }
  entry.refs++;
  return entry;
}

export function releaseDoc(id: string): void {
  const entry = live.get(id);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    live.delete(id);
    void entry.persistence.destroy();
    entry.doc.destroy();
  }
}

export function titleOf(doc: Y.Doc): Y.Text {
  return doc.getText("title");
}

export function contentOf(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment("content");
}

/** Plain text of the document body, for counting and search. */
export function plainText(fragment: Y.XmlFragment): string {
  const out: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
    if (node instanceof Y.XmlText) {
      out.push(node.toString().replace(/<[^>]+>/g, ""));
      return;
    }
    node.toArray().forEach((child) => walk(child as Y.XmlElement | Y.XmlText));
    if (node instanceof Y.XmlElement) out.push("\n");
  };
  walk(fragment);
  return out.join("");
}
