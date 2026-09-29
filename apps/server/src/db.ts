import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite via Node's built-in `node:sqlite` — no native build step, one file on disk, easy to back up.
 * Migrations are append-only; each runs once, in order, inside a transaction.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE doc_updates (
     doc_id TEXT NOT NULL,
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     update_data BLOB NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   CREATE INDEX doc_updates_doc ON doc_updates(doc_id, seq);`,
  // 2: accounts, sessions, workspaces, invites, instance settings, document registry
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     password_hash TEXT,
     is_admin INTEGER NOT NULL DEFAULT 0,
     avatar_color TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE oauth_accounts (
     provider TEXT NOT NULL,
     provider_user_id TEXT NOT NULL,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (provider, provider_user_id)
   );
   CREATE TABLE password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL,
     used INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL
   );
   CREATE TABLE members (
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest')),
     joined_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, user_id)
   );
   CREATE TABLE invites (
     token_hash TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     email TEXT NOT NULL COLLATE NOCASE,
     role TEXT NOT NULL,
     invited_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     accepted_at TEXT
   );
   CREATE TABLE instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     created_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL
   );`,
  // 3: per-document sharing
  `CREATE TABLE doc_shares (
     doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     granted_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT,
     PRIMARY KEY (doc_id, user_id)
   );
   CREATE INDEX doc_shares_user ON doc_shares(user_id);
   CREATE TABLE share_links (
     id TEXT PRIMARY KEY,
     doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     token_hash TEXT NOT NULL UNIQUE,
     role TEXT NOT NULL,
     created_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     revoked_at TEXT
   );
   CREATE TABLE public_links (
     doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
     token TEXT NOT NULL UNIQUE,
     created_by TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL
   );`,
];

export type Db = DatabaseSync;

export function openDatabase(dataDir: string | ":memory:"): Db {
  let db: DatabaseSync;
  if (dataDir === ":memory:") db = new DatabaseSync(":memory:");
  else {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(join(dataDir, "vellum.db"));
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS);
  return db;
}

export function migrate(db: Db, migrations: string[]): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < migrations.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[i]!);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        i + 1,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Register additional migrations from feature modules. Kept in one ordered list. */
export function registerMigrations(...sql: string[]): void {
  MIGRATIONS.push(...sql);
}
