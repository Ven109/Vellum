import { createId } from "@vellum/core";
import type { Collection, DocumentMeta, User, Workspace } from "@vellum/core";
import { create } from "zustand";
import { IndexedDbRepository } from "../data/idb.js";
import { backfill, removeFromIndex, updateIndexedTitle } from "../data/search.js";
import type { Repository } from "../data/repository.js";
import { ensureSeeded, nextCollectionColour } from "../data/seed.js";

export interface AppState {
  repo: Repository;
  ready: boolean;
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  collections: Collection[];
  documents: DocumentMeta[];
  welcomeDocId: string | null;
  /** Other people in this workspace (filled in once accounts exist). */
  members: Array<{ id: string; name: string }>;

  init(repo?: Repository): Promise<void>;
  refresh(): Promise<void>;
  createDocument(
    input?: Partial<Pick<DocumentMeta, "title" | "collectionId" | "isTemplate">>,
  ): Promise<DocumentMeta>;
  updateDocument(id: string, patch: Partial<DocumentMeta>): Promise<void>;
  updateDocuments(ids: string[], patch: Partial<DocumentMeta>): Promise<void>;
  deleteDocuments(ids: string[]): Promise<void>;
  createCollection(name: string): Promise<Collection>;
  updateCollection(id: string, patch: Partial<Pick<Collection, "name" | "color">>): Promise<void>;
  /** Delete a collection; its documents become unfiled. */
  deleteCollection(id: string): Promise<void>;
  reorderCollections(orderedIds: string[]): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  updateWorkspaceSettings(patch: Partial<Workspace["settings"]>): Promise<void>;
}

const initialising = new WeakMap<Repository, Promise<void>>();
const writes = new Map<string, Promise<void>>();

export const useApp = create<AppState>((set, get) => {
  async function doInit() {
    const { user, workspace } = await ensureSeeded(get().repo);
    set({ user, workspace, welcomeDocId: (await get().repo.getSetting<string>("welcomeDocId")) ?? null });
    await get().refresh();
    set({ ready: true });
    // Index anything that isn't searchable yet, off the critical path.
    setTimeout(() => void backfill(get().documents), 500);
  }

  return {
    repo: new IndexedDbRepository(),
    ready: false,
    user: null,
    workspace: null,
    workspaces: [],
    collections: [],
    documents: [],
    welcomeDocId: null,
    members: [],

    init(repo) {
      // Idempotent: React StrictMode and multiple mounts must not seed twice.
      if (repo) set({ repo });
      const key = get().repo;
      let pending = initialising.get(key);
      if (!pending) {
        pending = doInit();
        initialising.set(key, pending);
      }
      return pending;
    },

    async refresh() {
      const { repo, workspace } = get();
      if (!workspace) return;
      const [workspaces, collections, documents] = await Promise.all([
        repo.listWorkspaces(),
        repo.listCollections(workspace.id),
        repo.listDocuments(workspace.id),
      ]);
      set({ workspaces, collections, documents });
    },

    async createDocument(input = {}) {
      const { repo, workspace, user } = get();
      if (!workspace || !user) throw new Error("App not initialised");
      const now = new Date().toISOString();
      const doc: DocumentMeta = {
        id: createId("doc"),
        workspaceId: workspace.id,
        collectionId: input.collectionId ?? null,
        title: input.title ?? "",
        status: "draft",
        ownerId: user.id,
        isTemplate: input.isTemplate ?? false,
        tags: [],
        wordCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      // Show and open the new draft immediately; the write is queued so later edits land after it.
      set({ documents: [doc, ...get().documents] });
      const write = repo.putDocument(doc);
      writes.set(
        doc.id,
        write.catch(() => undefined),
      );
      return doc;
    },

    async updateDocument(id, patch) {
      const { repo, documents } = get();
      const existing = documents.find((d) => d.id === id) ?? (await repo.getDocument(id));
      if (!existing) return;
      // Apply to in-memory state synchronously so concurrent patches (title, word count...) compose
      // instead of overwriting each other with stale copies.
      const current = get().documents.find((d) => d.id === id) ?? existing;
      const next = { ...current, ...patch, id };
      set({
        documents: [next, ...get().documents.filter((d) => d.id !== id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      });
      if (patch.title !== undefined && patch.title !== current.title)
        void updateIndexedTitle(id, patch.title);
      // Publishing (or unpublishing) changes what the voice profile learns from.
      if (patch.status !== undefined && (patch.status === "published") !== (current.status === "published")) {
        void import("../data/voice.js").then((v) => v.relearnVoice());
      }
      // Persist the latest merged state, one write at a time per document.
      const prev = writes.get(id) ?? Promise.resolve();
      const write = prev.then(async () => {
        const latest = get().documents.find((d) => d.id === id);
        if (latest) await repo.putDocument(latest);
      });
      writes.set(
        id,
        write.catch(() => undefined),
      );
      await write;
    },

    async updateDocuments(ids, patch) {
      const now = new Date().toISOString();
      for (const id of ids) await get().updateDocument(id, { ...patch, updatedAt: now });
    },

    async deleteDocuments(ids) {
      const { repo } = get();
      for (const id of ids) {
        await repo.deleteDocument(id);
        void removeFromIndex(id);
      }
      set({ documents: get().documents.filter((d) => !ids.includes(d.id)) });
    },

    async createCollection(name) {
      const { repo, workspace, collections } = get();
      if (!workspace) throw new Error("App not initialised");
      const collection: Collection = {
        id: createId("col"),
        workspaceId: workspace.id,
        name,
        color: nextCollectionColour(collections.length),
        sortOrder: collections.length,
      };
      await repo.putCollection(collection);
      set({ collections: [...collections, collection] });
      return collection;
    },

    async updateCollection(id, patch) {
      const { repo, collections } = get();
      const existing = collections.find((c) => c.id === id);
      if (!existing) return;
      const next = { ...existing, ...patch };
      await repo.putCollection(next);
      set({ collections: collections.map((c) => (c.id === id ? next : c)) });
    },

    async deleteCollection(id) {
      const { repo, documents } = get();
      const affected = documents.filter((d) => d.collectionId === id).map((d) => d.id);
      await get().updateDocuments(affected, { collectionId: null });
      await repo.deleteCollection(id);
      set({ collections: get().collections.filter((c) => c.id !== id) });
    },

    async reorderCollections(orderedIds) {
      const { repo, collections } = get();
      const next = orderedIds
        .map((id, i) => {
          const c = collections.find((x) => x.id === id);
          return c ? { ...c, sortOrder: i } : null;
        })
        .filter((c): c is Collection => c !== null);
      set({ collections: next });
      for (const c of next) await repo.putCollection(c);
    },

    async updateWorkspaceSettings(patch) {
      const { repo, workspace, user } = get();
      if (!workspace) return;
      const current = get().workspace ?? workspace;
      const next: Workspace = {
        ...current,
        settings: { ...current.settings, ...patch, updatedAt: new Date().toISOString(), updatedBy: user?.id },
      };
      // Update the UI first, then persist.
      set({ workspace: next, workspaces: get().workspaces.map((w) => (w.id === next.id ? next : w)) });
      await repo.putWorkspace(next);
    },

    async switchWorkspace(id) {
      const { repo } = get();
      const workspace = await repo.getWorkspace(id);
      if (!workspace) return;
      await repo.putSetting("currentWorkspaceId", id);
      set({ workspace });
      await get().refresh();
    },
  };
});
