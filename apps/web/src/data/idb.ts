import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Collection, DocumentMeta, User, Workspace } from "@vellum/core";
import type { Repository } from "./repository.js";

interface VellumDB extends DBSchema {
  users: { key: string; value: User };
  workspaces: { key: string; value: Workspace };
  collections: { key: string; value: Collection; indexes: { byWorkspace: string } };
  documents: { key: string; value: DocumentMeta; indexes: { byWorkspace: string } };
  settings: { key: string; value: unknown };
}

export class IndexedDbRepository implements Repository {
  private db: Promise<IDBPDatabase<VellumDB>>;

  constructor(name = "vellum") {
    this.db = openDB<VellumDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore("users", { keyPath: "id" });
        db.createObjectStore("workspaces", { keyPath: "id" });
        db.createObjectStore("collections", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
        db.createObjectStore("documents", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
        db.createObjectStore("settings");
      },
    });
  }

  async getCurrentUser() {
    const id = await this.getSetting<string>("currentUserId");
    return id ? (await this.db).get("users", id) : undefined;
  }
  async putUser(user: User) {
    await (await this.db).put("users", user);
    if (!(await this.getSetting("currentUserId"))) await this.putSetting("currentUserId", user.id);
  }

  async listWorkspaces() {
    return (await this.db).getAll("workspaces");
  }
  async getWorkspace(id: string) {
    return (await this.db).get("workspaces", id);
  }
  async putWorkspace(workspace: Workspace) {
    await (await this.db).put("workspaces", workspace);
  }

  async listCollections(workspaceId: string) {
    const all = await (await this.db).getAllFromIndex("collections", "byWorkspace", workspaceId);
    return all.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async putCollection(collection: Collection) {
    await (await this.db).put("collections", collection);
  }
  async deleteCollection(id: string) {
    await (await this.db).delete("collections", id);
  }

  async listDocuments(workspaceId: string) {
    const all = await (await this.db).getAllFromIndex("documents", "byWorkspace", workspaceId);
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getDocument(id: string) {
    return (await this.db).get("documents", id);
  }
  async putDocument(doc: DocumentMeta) {
    await (await this.db).put("documents", doc);
  }
  async deleteDocument(id: string) {
    await (await this.db).delete("documents", id);
  }

  async getSetting<T>(key: string) {
    return (await (await this.db).get("settings", key)) as T | undefined;
  }
  async putSetting<T>(key: string, value: T) {
    await (await this.db).put("settings", value, key);
  }
}
