import type { Collection, DocumentMeta, User, Version, Workspace, WritingSession } from "@vellum/core";

/**
 * Persistence boundary for workspace metadata. The document bodies themselves live in Yjs docs (see
 * `ydocs.ts`); this stores everything around them. Implementations: IndexedDB (local-first, default)
 * and, once a server is configured, a remote implementation with the same shape.
 */
export interface Repository {
  getCurrentUser(): Promise<User | undefined>;
  putUser(user: User): Promise<void>;

  listWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  putWorkspace(workspace: Workspace): Promise<void>;

  listCollections(workspaceId: string): Promise<Collection[]>;
  putCollection(collection: Collection): Promise<void>;
  deleteCollection(id: string): Promise<void>;

  listDocuments(workspaceId: string): Promise<DocumentMeta[]>;
  getDocument(id: string): Promise<DocumentMeta | undefined>;
  putDocument(doc: DocumentMeta): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  putVersion(version: Version): Promise<void>;
  listVersions(documentId: string): Promise<Version[]>;
  deleteVersion(id: string): Promise<void>;

  /** Writing sessions stay on this device: they are never synced or uploaded. */
  putSession(session: WritingSession): Promise<void>;
  /** Sessions that ended between `from` and `to` (ISO timestamps, inclusive). */
  listSessions(from: string, to: string): Promise<WritingSession[]>;

  getSetting<T>(key: string): Promise<T | undefined>;
  putSetting<T>(key: string, value: T): Promise<void>;
}
