import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Collection, DocumentMeta, User, Version, Workspace, WritingSession } from "@vellum/core";
import type { Repository } from "./repository.js";

interface VellumDB extends DBSchema {
  users: { key: string; value: User };
  workspaces: { key: string; value: Workspace };
  collections: { key: string; value: Collection; indexes: { byWorkspace: string } };
  documents: { key: string; value: DocumentMeta; indexes: { byWorkspace: string } };
  settings: { key: string; value: unknown };
  versions: { key: string; value: Version; indexes: { byDocument: string } };
  sessions: { key: string; value: WritingSession; indexes: { byEnd: string } };
}

export class IndexedDbRepository implements Repository {
  private db: Promise<IDBPDatabase<VellumDB>>;

  constructor(name = "vellum") {
    this.db = openDB<VellumDB>(name, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("users", { keyPath: "id" });
          db.createObjectStore("workspaces", { keyPath: "id" });
          db.createObjectStore("collections", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
          db.createObjectStore("documents", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
          db.createObjectStore("settings");
        }
        if (oldVersion < 2) {
          db.createObjectStore("versions", { keyPath: "id" }).createIndex("byDocument", "documentId");
        }
        if (oldVersion < 3) {
          db.createObjectStore("sessions", { keyPath: "id" }).createIndex("byEnd", "endedAt");
        }
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

  async putVersion(version: Version) {
    await (await this.db).put("versions", version);
  }
  async listVersions(documentId: string) {
    const all = await (await this.db).getAllFromIndex("versions", "byDocument", documentId);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async deleteVersion(id: string) {
    await (await this.db).delete("versions", id);
  }

  async putSession(session: WritingSession) {
    await (await this.db).put("sessions", session);
  }
  async listSessions(from: string, to: string) {
    return (await this.db).getAllFromIndex("sessions", "byEnd", IDBKeyRange.bound(from, to));
  }

  async getSetting<T>(key: string) {
    return (await (await this.db).get("settings", key)) as T | undefined;
  }
  async putSetting<T>(key: string, value: T) {
    await (await this.db).put("settings", value, key);
  }
}
