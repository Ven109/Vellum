import type { DocumentMeta } from "@vellum/core";
import { create } from "zustand";
import { useApp } from "../state/app.js";
import { account } from "./account.js";
import { acquireDoc, releaseDoc } from "./ydocs.js";
import { dirtyDocs, keepEverythingOffline, setSyncedVersion, syncedVersion } from "./sync-state.js";

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

type RemoteDoc = { id: string; title: string; createdBy: string; createdAt: string; version?: number };

/**
 * Add documents that exist on the server but not on this device yet (created elsewhere). Returns the
 * server's list, with each document's version, for deciding what needs syncing.
 */
export async function pullDocumentList(): Promise<RemoteDoc[]> {
  const { account: me, repo } = useApp.getState();
  if (!me) return [];
  let added = 0;
  const all: RemoteDoc[] = [];
  for (const ws of me.workspaces) {
    if (ws.role === "guest") continue;
    const remote = await account.workspaceDocuments(ws.id).catch(() => [] as RemoteDoc[]);
    all.push(...remote);
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
  return all;
}

/** Open a document briefly so the sync provider exchanges changes with the server, then let it go. */
async function syncOne(id: string): Promise<boolean> {
  const live = acquireDoc(id);
  try {
    await live.whenLoaded;
    const start = Date.now();
    while (Date.now() - start < PER_DOC_TIMEOUT_MS) {
      const r = live.remote;
      if (!r || r.state === "denied") return false;
      if (r.isSynced && !r.hasPendingChanges) return true;
      await new Promise((res) => setTimeout(res, 100));
    }
    return false;
  } finally {
    releaseDoc(id);
  }
}

let running: Promise<void> | null = null;

/**
 * Bring documents up to date without opening each one:
 * - documents with edits the server hasn't confirmed are pushed, even after they were closed;
 * - where every document is kept offline (the desktop app), documents that changed on the server since
 *   this device last synced them come down, as do ones created elsewhere.
 * The CRDT merges concurrent edits; see useSnapshots for how merges are recorded in history.
 */
export function syncAllDocuments(): Promise<void> {
  running ??= (async () => {
    try {
      const { account: me } = useApp.getState();
      if (!me) return;
      const remote = await pullDocumentList();
      const versions = new Map(remote.map((d) => [d.id, d.version ?? 0]));
      const ids = new Set(dirtyDocs());
      if (keepEverythingOffline()) {
        for (const d of remote) if (syncedVersion(d.id) !== (d.version ?? 0)) ids.add(d.id);
        for (const s of useApp.getState().shared) ids.add(s.docId);
      }
      const list = [...ids];
      useBackgroundSync.setState({ running: list.length > 0, done: 0, total: list.length });
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const id = list[next++]!;
          const ok = await syncOne(id).catch(() => false);
          if (ok && versions.has(id)) setSyncedVersion(id, versions.get(id)!);
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
