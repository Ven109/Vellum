import type { DocumentMeta } from "@vellum/core";
import { create } from "zustand";
import { useApp } from "../state/app.js";
import { account } from "./account.js";
import { acquireDoc, releaseDoc } from "./ydocs.js";

interface BackgroundSyncState {
  running: boolean;
  done: number;
  total: number;
  lastSyncedAt: string | null;
}

export const useBackgroundSync = create<BackgroundSyncState>(() => ({
  running: false,
  done: 0,
  total: 0,
  lastSyncedAt: null,
}));

const EVERY_MS = 15 * 60_000;
const CONCURRENCY = 2;
const PER_DOC_TIMEOUT_MS = 20_000;

/** Add documents that exist on the server but not on this device yet (created elsewhere). */
export async function pullDocumentList(): Promise<number> {
  const { account: me, repo } = useApp.getState();
  if (!me) return 0;
  let added = 0;
  for (const ws of me.workspaces) {
    if (ws.role === "guest") continue;
    const remote = await account.workspaceDocuments(ws.id).catch(() => []);
    const local = new Set((await repo.listDocuments(ws.id)).map((d) => d.id));
    for (const d of remote) {
      if (local.has(d.id)) continue;
      const meta: DocumentMeta = {
        id: d.id,
        workspaceId: ws.id,
        collectionId: null,
        title: d.title === "Untitled" ? "" : d.title,
        status: "draft",
        ownerId: d.createdBy,
        isTemplate: false,
        tags: [],
        wordCount: 0,
        createdAt: d.createdAt,
        updatedAt: d.createdAt,
      };
      await repo.putDocument(meta);
      added++;
    }
  }
  if (added) await useApp.getState().refresh();
  return added;
}

/** Open a document briefly so the sync provider exchanges changes with the server, then let it go. */
async function syncOne(id: string): Promise<void> {
  const live = acquireDoc(id);
  try {
    await live.whenLoaded;
    const start = Date.now();
    while (Date.now() - start < PER_DOC_TIMEOUT_MS) {
      const r = live.remote;
      if (!r || r.state === "denied") return;
      if (r.isSynced && !r.hasPendingChanges) return;
      await new Promise((res) => setTimeout(res, 100));
    }
  } finally {
    releaseDoc(id);
  }
}

let running: Promise<void> | null = null;

/**
 * Bring every document in the account's workspaces (and those shared with you) up to date in both
 * directions: offline edits go up, changes made elsewhere come down, so everything is ready offline.
 * The CRDT merges concurrent edits; see useSnapshots for how merges are recorded in history.
 */
export function syncAllDocuments(): Promise<void> {
  running ??= (async () => {
    try {
      const { account: me, repo } = useApp.getState();
      if (!me) return;
      await pullDocumentList();
      const ids: string[] = [];
      for (const ws of me.workspaces) {
        if (ws.role === "guest") continue;
        for (const d of await repo.listDocuments(ws.id)) ids.push(d.id);
      }
      for (const s of useApp.getState().shared) ids.push(s.docId);
      useBackgroundSync.setState({ running: true, done: 0, total: ids.length });
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          await syncOne(id).catch(() => undefined);
          useBackgroundSync.setState((s) => ({ done: s.done + 1 }));
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      useBackgroundSync.setState({ lastSyncedAt: new Date().toISOString() });
    } finally {
      useBackgroundSync.setState({ running: false });
      running = null;
    }
  })();
  return running;
}

let started = false;

/** Sync now, whenever the connection comes back, and every 15 minutes. */
export function startBackgroundSync(): void {
  if (started) return;
  started = true;
  void syncAllDocuments();
  window.addEventListener("online", () => void syncAllDocuments());
  setInterval(() => void syncAllDocuments(), EVERY_MS);
}
