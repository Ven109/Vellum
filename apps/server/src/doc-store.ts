import * as Y from "yjs";
import type { Db } from "./db.js";

/**
 * Append-only storage of Yjs updates per document. Loading merges all updates; once a document has more
 * than {@link COMPACT_THRESHOLD} rows they are merged into one.
 */
export const COMPACT_THRESHOLD = 200;

export class DocStore {
  constructor(private readonly db: Db) {}

  load(docId: string): Y.Doc {
    const doc = new Y.Doc({ guid: docId });
    const rows = this.db
      .prepare("SELECT update_data FROM doc_updates WHERE doc_id = ? ORDER BY seq")
      .all(docId) as Array<{ update_data: Uint8Array }>;
    if (rows.length) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update_data))));
    return doc;
  }

  exists(docId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM doc_updates WHERE doc_id = ? LIMIT 1").get(docId);
  }

  append(docId: string, update: Uint8Array): void {
    this.db.prepare("INSERT INTO doc_updates (doc_id, update_data) VALUES (?, ?)").run(docId, update);
  }

  count(docId: string): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM doc_updates WHERE doc_id = ?").get(docId) as { n: number }
    ).n;
  }

  /** Replace all stored updates for a document with a single merged update. */
  compact(docId: string): void {
    const rows = this.db
      .prepare("SELECT seq, update_data FROM doc_updates WHERE doc_id = ? ORDER BY seq")
      .all(docId) as Array<{ seq: number; update_data: Uint8Array }>;
    if (rows.length < 2) return;
    const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update_data)));
    const last = rows[rows.length - 1]!.seq;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM doc_updates WHERE doc_id = ? AND seq <= ?").run(docId, last);
      this.append(docId, merged);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  delete(docId: string): void {
    this.db.prepare("DELETE FROM doc_updates WHERE doc_id = ?").run(docId);
  }
}
