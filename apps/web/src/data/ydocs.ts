import * as Y from "yjs";
import { LocalDocPersistence } from "./local-persistence.js";
import { detectServer, syncUrl, syncWorkspaceFor } from "./server.js";
import { DocSyncProvider } from "./sync-provider.js";

export type SaveState = "saved" | "saving" | "offline" | "error";

/**
 * One live Y.Doc per open document. The Y.Doc is the single source of truth for content (ADR 0001):
 * `content` is the ProseMirror fragment and `title` the title. Every update is written to IndexedDB
 * immediately and, when a server is available, synced to it in debounced batches.
 */
export class LiveDoc {
  readonly doc: Y.Doc;
  readonly local: LocalDocPersistence;
  remote: DocSyncProvider | null = null;
  readonly whenLoaded: Promise<void>;
  /** True when this session found edits from a previous session that never reached the server. */
  recovered = false;
  refs = 0;
  private listeners = new Set<() => void>();
  private mergedListeners = new Set<() => void>();

  constructor(readonly id: string) {
    this.doc = new Y.Doc({ guid: id });
    this.local = new LocalDocPersistence(id, this.doc);
    this.local.onChange(() => this.emit());
    this.whenLoaded = this.local.whenLoaded.then(async () => {
      const workspaceId = syncWorkspaceFor(id);
      if (workspaceId && (await detectServer())) {
        this.remote = new DocSyncProvider(id, this.doc, syncUrl(id, workspaceId), {
          change: () => this.emit(),
          merged: () => this.mergedListeners.forEach((l) => l()),
        });
        this.recovered = hasLocalAckRecord(id) && this.remote.hasPendingChanges;
      }
    });
  }

  get saveState(): SaveState {
    if (this.local.hasFailed) return "error";
    if (this.remote) {
      if (this.remote.state !== "connected") return "offline";
      if (this.local.isWriting || this.remote.hasPendingChanges) return "saving";
      return "saved";
    }
    return this.local.isWriting ? "saving" : "saved";
  }

  onStatus(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onMerged(fn: () => void): () => void {
    this.mergedListeners.add(fn);
    return () => this.mergedListeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  destroy(): void {
    this.remote?.destroy();
    this.local.destroy();
    this.listeners.clear();
    this.mergedListeners.clear();
    this.doc.destroy();
  }
}

function hasLocalAckRecord(id: string): boolean {
  try {
    return localStorage.getItem(`vellum:acked:${id}`) !== null;
  } catch {
    return false;
  }
}

const live = new Map<string, LiveDoc>();

export function acquireDoc(id: string): LiveDoc {
  let entry = live.get(id);
  if (!entry) {
    entry = new LiveDoc(id);
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
    // Keep the doc alive briefly so a quick re-open (e.g. React StrictMode remount) reuses it.
    setTimeout(() => {
      if (entry.refs <= 0 && live.get(id) === entry) {
        live.delete(id);
        entry.destroy();
      }
    }, 1000);
  }
}

/** True while any open document has writes in flight or unsynced changes with a connected server. */
export function hasUnsavedWork(): boolean {
  for (const d of live.values()) if (d.saveState === "saving" || d.saveState === "error") return true;
  return false;
}

export function flushAll(): void {
  for (const d of live.values()) d.remote?.flush();
}

export function titleOf(doc: Y.Doc): Y.Text {
  return doc.getText("title");
}

export function contentOf(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment("content");
}
