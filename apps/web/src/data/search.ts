import { SearchIndex } from "@vellum/core";
import type { SerializedIndex } from "@vellum/core";
import { openDB } from "idb";
import * as Y from "yjs";
import { LocalDocPersistence } from "./local-persistence.js";

/**
 * Full-text search over every document on this device. The index lives in memory and is persisted to
 * IndexedDB, so it works offline and survives reloads. Documents are re-indexed as they are edited;
 * documents never opened on this device are indexed in the background from their local CRDT state.
 */
const DB = "vellum-search";
let index: SearchIndex | null = null;
let loading: Promise<SearchIndex> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function db() {
  return openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore("index");
    },
  });
}

export function loadSearchIndex(): Promise<SearchIndex> {
  loading ??= (async () => {
    try {
      const data = (await (await db()).get("index", "main")) as SerializedIndex | undefined;
      index = data ? SearchIndex.fromJSON(data) : new SearchIndex();
    } catch {
      index = new SearchIndex();
    }
    return index;
  })();
  return loading;
}

export function searchIndexSync(): SearchIndex | null {
  return index;
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!index) return;
    void db().then((d) => d.put("index", index!.toJSON(), "main"));
  }, 1500);
  listeners.forEach((l) => l());
}

export async function indexDocument(id: string, title: string, body: string): Promise<void> {
  const idx = await loadSearchIndex();
  idx.upsert({ id, title, body });
  schedulePersist();
}

export async function removeFromIndex(id: string): Promise<void> {
  const idx = await loadSearchIndex();
  idx.remove(id);
  schedulePersist();
}

export function onIndexChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Plain text of a Yjs ProseMirror fragment, one line per block. */
export function fragmentText(fragment: Y.XmlFragment): string {
  const lines: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment, into: string[]) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        into.push(
          (child.toDelta() as Array<{ insert: unknown }>)
            .map((d) => (typeof d.insert === "string" ? d.insert : ""))
            .join(""),
        );
      } else if (child instanceof Y.XmlElement) {
        const inner: string[] = [];
        walk(child, inner);
        const text = inner.join("");
        if (["paragraph", "heading", "codeBlock", "listItem", "blockquote"].includes(child.nodeName))
          lines.push(text);
        else into.push(text);
      }
    }
  };
  walk(fragment, lines);
  return lines.filter(Boolean).join("\n");
}

/** Index documents that are not in the index yet, reading their local CRDT state. */
export async function backfill(docs: Array<{ id: string; title: string }>): Promise<number> {
  const idx = await loadSearchIndex();
  let n = 0;
  for (const d of docs) {
    if (idx.has(d.id)) continue;
    const ydoc = new Y.Doc();
    const p = new LocalDocPersistence(d.id, ydoc);
    await p.whenLoaded;
    idx.upsert({ id: d.id, title: d.title, body: fragmentText(ydoc.getXmlFragment("content")) });
    p.destroy();
    ydoc.destroy();
    n++;
  }
  if (n) schedulePersist();
  return n;
}

export async function updateIndexedTitle(id: string, title: string): Promise<void> {
  const idx = await loadSearchIndex();
  const existing = idx.get(id);
  idx.upsert({ id, title, body: existing?.body ?? "" });
  schedulePersist();
}
