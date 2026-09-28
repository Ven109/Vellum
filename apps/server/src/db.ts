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
