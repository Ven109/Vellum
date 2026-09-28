import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import * as Y from "yjs";

interface DocsDB extends DBSchema {
  updates: { key: number; value: { docId: string; update: Uint8Array }; indexes: { byDoc: string } };
}

let dbPromise: Promise<IDBPDatabase<DocsDB>> | null = null;
function db() {
  dbPromise ??= openDB<DocsDB>("vellum-docs", 1, {
    upgrade(d) {
      d.createObjectStore("updates", { autoIncrement: true }).createIndex("byDoc", "docId");
    },
  });
  return dbPromise;
}

const COMPACT_AFTER = 300;
export const LOCAL_ORIGIN = Symbol("vellum-local-load");

/**
 * Persists every Yjs update for a document to IndexedDB as it happens, and reports honestly whether
 * writes are still in flight. This is what makes crash recovery work: anything typed has already been
 * written locally before the top bar says "Saved".
 */
export class LocalDocPersistence {
  private inflight = 0;
  private stored = 0;
  private listeners = new Set<() => void>();
  private failed = false;
  readonly whenLoaded: Promise<void>;
  private destroyed = false;

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN || this.destroyed) return;
    this.inflight++;
    this.emit();
    void db()
      .then((d) => d.add("updates", { docId: this.docId, update }))
      .then(() => {
        this.stored++;
        this.failed = false;
        if (this.stored > COMPACT_AFTER) void this.compact();
      })
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        this.inflight--;
        this.emit();
      });
  };

  constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
  ) {
    this.whenLoaded = this.load();
    doc.on("update", this.onUpdate);
  }

  private async load() {
    const d = await db();
    const rows = await d.getAllFromIndex("updates", "byDoc", this.docId);
    this.stored = rows.length;
    if (rows.length) {
      Y.transact(this.doc, () => rows.forEach((r) => Y.applyUpdate(this.doc, r.update)), LOCAL_ORIGIN);
    }
  }

  /** Merge stored updates into one row. */
  async compact(): Promise<void> {
    const d = await db();
    const tx = d.transaction("updates", "readwrite");
    const keys = await tx.store.index("byDoc").getAllKeys(this.docId);
    for (const key of keys) await tx.store.delete(key);
    await tx.store.add({ docId: this.docId, update: Y.encodeStateAsUpdate(this.doc) });
    await tx.done;
    this.stored = 1;
  }

  get isWriting(): boolean {
    return this.inflight > 0;
  }

  get hasFailed(): boolean {
    return this.failed;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.off("update", this.onUpdate);
    this.listeners.clear();
  }

  static async clear(docId: string): Promise<void> {
    const d = await db();
    const tx = d.transaction("updates", "readwrite");
    for (const key of await tx.store.index("byDoc").getAllKeys(docId)) await tx.store.delete(key);
    await tx.done;
  }
}
