import { RetentionPolicy, Version, versionsToPrune } from "@vellum/core";
import type { VersionAuthor } from "@vellum/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db.js";
import { AuthError } from "../auth/service.js";
import type { AccountService, UserRow } from "../auth/service.js";
import type { SharingService } from "../sharing/service.js";

interface Row {
  id: string;
  doc_id: string;
  created_at: string;
  author: string;
  reason: string;
  name: string | null;
  title: string | null;
  stats: string;
  markdown?: string;
}

const DOC_ID = /^doc_[0-9a-z]{10,40}$/;
const DEFAULT_RETENTION = RetentionPolicy.parse({});

function toVersion(r: Row): Omit<Version, "markdown"> & { markdown?: string } {
  return {
    id: r.id,
    documentId: r.doc_id,
    createdAt: r.created_at,
    author: JSON.parse(r.author) as Version["author"],
    reason: r.reason as Version["reason"],
    ...(r.name ? { name: r.name } : {}),
    ...(r.title !== null ? { title: r.title } : {}),
    stats: JSON.parse(r.stats) as Version["stats"],
    ...(r.markdown !== undefined ? { markdown: r.markdown } : {}),
  };
}

/**
 * Shared version history for synced documents. Clients make the snapshots (they hold the editor that
 * turns the document into Markdown); the server checks attribution, stores them and applies the
 * workspace's retention policy, never pruning a named version.
 */
export function historyPlugin(
  app: FastifyInstance,
  deps: { db: Db; accounts: AccountService; sharing: SharingService },
) {
  const { db, accounts, sharing } = deps;

  const requireUser = (req: FastifyRequest): UserRow => {
    if (!req.user) throw new AuthError(401, "unauthenticated", "Sign in to continue.");
    return req.user;
  };
  const docParam = (id: string) => {
    if (!DOC_ID.test(id)) throw new AuthError(404, "not_found", "No such document.");
    return id;
  };

  const retentionFor = (workspaceId: string): RetentionPolicy => {
    const row = db.prepare("SELECT retention FROM workspaces WHERE id = ?").get(workspaceId) as
      { retention: string | null } | undefined;
    if (!row?.retention) return DEFAULT_RETENTION;
    const parsed = RetentionPolicy.safeParse(JSON.parse(row.retention));
    return parsed.success ? parsed.data : DEFAULT_RETENTION;
  };

  const prune = (docId: string) => {
    const workspaceId = accounts.documentWorkspace(docId);
    if (!workspaceId) return;
    const rows = db
      .prepare("SELECT id, created_at, reason, name FROM versions WHERE doc_id = ?")
      .all(docId) as unknown as Array<{
      id: string;
      created_at: string;
      reason: Version["reason"];
      name: string | null;
    }>;
    const drop = versionsToPrune(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        reason: r.reason,
        ...(r.name ? { name: r.name } : {}),
      })),
      retentionFor(workspaceId),
    );
    const del = db.prepare("DELETE FROM versions WHERE id = ?");
    for (const id of drop) del.run(id);
  };

  app.get<{ Params: { id: string } }>("/api/documents/:id/versions", async (req) => {
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, requireUser(req), "view");
    const rows = db
      .prepare(
        "SELECT id, doc_id, created_at, author, reason, name, title, stats FROM versions WHERE doc_id = ? ORDER BY created_at DESC",
      )
      .all(docId) as unknown as Row[];
    return rows.map(toVersion);
  });

  app.get<{ Params: { id: string; vid: string } }>("/api/documents/:id/versions/:vid", async (req) => {
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, requireUser(req), "view");
    const row = db
      .prepare("SELECT * FROM versions WHERE id = ? AND doc_id = ?")
      .get(req.params.vid, docId) as Row | undefined;
    if (!row) throw new AuthError(404, "not_found", "That version no longer exists.");
    return toVersion(row);
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/documents/:id/versions", async (req) => {
    const user = requireUser(req);
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, user, "suggest");
    const parsed = Version.safeParse({ ...(req.body as object), documentId: docId });
    if (!parsed.success) throw new AuthError(400, "invalid_version", "That version couldn't be read.");
    const v = parsed.data;
    // Attribution must name the person uploading it: nobody records edits in someone else's name.
    const author: VersionAuthor =
      v.author.kind === "user"
        ? { kind: "user", userId: user.id }
        : v.author.kind === "assistant"
          ? { ...v.author, requestedBy: user.id }
          : v.author.kind === "suggestion"
            ? { ...v.author, acceptedBy: user.id }
            : v.author;
    if (v.markdown.length > 5_000_000) throw new AuthError(413, "too_large", "That version is too large.");
    db.prepare(
      "INSERT OR IGNORE INTO versions (id, doc_id, created_at, author, reason, name, title, stats, markdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      v.id,
      docId,
      v.createdAt,
      JSON.stringify(author),
      v.reason,
      v.name ?? null,
      v.title ?? null,
      JSON.stringify(v.stats),
      v.markdown,
    );
    prune(docId);
    return toVersion({ ...(db.prepare("SELECT * FROM versions WHERE id = ?").get(v.id) as unknown as Row) });
  });

  app.patch<{ Params: { id: string; vid: string }; Body: { name: string | null } }>(
    "/api/documents/:id/versions/:vid",
    async (req) => {
      const docId = docParam(req.params.id);
      sharing.requireRole(docId, requireUser(req), "edit");
      const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
      db.prepare("UPDATE versions SET name = ? WHERE id = ? AND doc_id = ?").run(
        name || null,
        req.params.vid,
        docId,
      );
      prune(docId);
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>("/api/workspaces/:id/retention", async (req) => {
    const user = requireUser(req);
    if (!accounts.roleIn(req.params.id, user.id))
      throw new AuthError(403, "forbidden", "You don't have access to that.");
    return retentionFor(req.params.id);
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/workspaces/:id/retention", async (req) => {
    const user = requireUser(req);
    const role = accounts.roleIn(req.params.id, user.id);
    if (role !== "owner" && role !== "admin")
      throw new AuthError(403, "forbidden", "Only owners and admins can change this.");
    const parsed = RetentionPolicy.safeParse(req.body);
    if (!parsed.success) throw new AuthError(400, "invalid_retention", "Retention must be whole days.");
    db.prepare("UPDATE workspaces SET retention = ? WHERE id = ?").run(
      JSON.stringify(parsed.data),
      req.params.id,
    );
    return parsed.data;
  });
}
