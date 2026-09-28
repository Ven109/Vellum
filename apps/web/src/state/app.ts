import { createId } from "@vellum/core";
import type { Collection, DocumentMeta, User, Workspace } from "@vellum/core";
import { create } from "zustand";
import { IndexedDbRepository } from "../data/idb.js";
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

  init(repo?: Repository): Promise<void>;
  refresh(): Promise<void>;
  createDocument(input?: Partial<Pick<DocumentMeta, "title" | "collectionId">>): Promise<DocumentMeta>;
  updateDocument(id: string, patch: Partial<DocumentMeta>): Promise<void>;
  createCollection(name: string): Promise<Collection>;
  switchWorkspace(id: string): Promise<void>;
}

const initialising = new WeakMap<Repository, Promise<void>>();

export const useApp = create<AppState>((set, get) => {
  async function doInit() {
    const { user, workspace } = await ensureSeeded(get().repo);
    set({ user, workspace, welcomeDocId: (await get().repo.getSetting<string>("welcomeDocId")) ?? null });
    await get().refresh();
    set({ ready: true });
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
        isTemplate: false,
        tags: [],
        wordCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await repo.putDocument(doc);
      set({ documents: [doc, ...get().documents] });
      return doc;
    },

    async updateDocument(id, patch) {
      const { repo, documents } = get();
      const existing = documents.find((d) => d.id === id) ?? (await repo.getDocument(id));
      if (!existing) return;
      const next = { ...existing, ...patch, id };
      await repo.putDocument(next);
      set({
        documents: [next, ...get().documents.filter((d) => d.id !== id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      });
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
