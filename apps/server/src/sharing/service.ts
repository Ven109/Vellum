import { createId } from "@vellum/core";
import type { Db } from "../db.js";
import { hashToken, newToken } from "../auth/crypto.js";
import { AuthError, toPublic } from "../auth/service.js";
import type { AccountService, PublicUser, UserRow } from "../auth/service.js";

/** What someone may do with a document, weakest first. */
export const DOC_ROLES = ["view", "comment", "suggest", "edit"] as const;
export type DocRole = (typeof DOC_ROLES)[number];

export function isDocRole(v: unknown): v is DocRole {
  return typeof v === "string" && (DOC_ROLES as readonly string[]).includes(v);
}

const rank = (r: DocRole | undefined) => (r ? DOC_ROLES.indexOf(r) : -1);
export const strongest = (a: DocRole | undefined, b: DocRole | undefined) => (rank(a) >= rank(b) ? a : b);

/** Top-level Y.Doc types each role may change. `null` means any. */
export const WRITABLE_ROOTS: Record<DocRole, readonly string[] | null> = {
  view: [],
  comment: ["threads"],
  // Suggesting edits the content as marked proposals; the client forces suggesting mode.
  suggest: null,
  edit: null,
};

const now = () => new Date().toISOString();
const LINK_DAYS = [1, 7, 30] as const;

export interface ShareEntry extends PublicUser {
  role: DocRole;
  grantedBy: string;
  expiresAt: string | null;
}

export interface LinkEntry {
  id: string;
  role: DocRole;
  expiresAt: string;
  createdAt: string;
}

export class SharingService {
  constructor(
    private readonly db: Db,
    private readonly accounts: AccountService,
  ) {}

  /**
   * A person's role on a document: workspace members (not guests) can edit; anyone else needs a share
   * that hasn't expired. Undefined means no access.
   */
  roleFor(
    docId: string,
    userId: string,
    workspaceId = this.accounts.documentWorkspace(docId),
  ): DocRole | undefined {
    if (!workspaceId) return undefined;
    const wsRole = this.accounts.roleIn(workspaceId, userId);
    const fromWorkspace: DocRole | undefined = wsRole && wsRole !== "guest" ? "edit" : undefined;
    const row = this.db
      .prepare("SELECT role, expires_at FROM doc_shares WHERE doc_id = ? AND user_id = ?")
      .get(docId, userId) as { role: DocRole; expires_at: string | null } | undefined;
    const shared = row && (!row.expires_at || row.expires_at > now()) ? row.role : undefined;
    return strongest(fromWorkspace, shared);
  }

  requireRole(docId: string, user: UserRow, minimum: DocRole): DocRole {
    if (!this.accounts.documentWorkspace(docId))
      throw new AuthError(404, "not_found", "That document hasn't been synced to this server yet.");
    const role = this.roleFor(docId, user.id);
    if (rank(role) < rank(minimum)) throw new AuthError(403, "forbidden", "You don't have access to that.");
    return role!;
  }

  shares(docId: string): ShareEntry[] {
    const rows = this.db
      .prepare(
        `SELECT u.*, s.role AS share_role, s.granted_by, s.expires_at AS share_expires FROM doc_shares s
         JOIN users u ON u.id = s.user_id WHERE s.doc_id = ? AND (s.expires_at IS NULL OR s.expires_at > ?)
         ORDER BY s.created_at`,
      )
      .all(docId, now()) as unknown as Array<
      UserRow & { share_role: DocRole; granted_by: string; share_expires: string | null }
    >;
    return rows.map((r) => ({
      ...toPublic(r),
      role: r.share_role,
      grantedBy: r.granted_by,
      expiresAt: r.share_expires,
    }));
  }

  share(docId: string, email: string, role: DocRole, grantedBy: string): ShareEntry {
    if (!isDocRole(role)) throw new AuthError(400, "invalid_role", "Choose view, comment, suggest or edit.");
    const user = this.accounts.userByEmail(email.trim());
    if (!user)
      throw new AuthError(
        404,
        "no_account",
        "No one on this server uses that email. Invite them to the workspace first.",
      );
    this.grant(docId, user.id, role, grantedBy, null);
    return this.shares(docId).find((s) => s.id === user.id)!;
  }

  private grant(docId: string, userId: string, role: DocRole, grantedBy: string, expiresAt: string | null) {
    this.db
      .prepare(
        `INSERT INTO doc_shares (doc_id, user_id, role, granted_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (doc_id, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by,
           expires_at = excluded.expires_at`,
      )
      .run(docId, userId, role, grantedBy, now(), expiresAt);
  }

  setShareRole(docId: string, userId: string, role: DocRole): void {
    if (!isDocRole(role)) throw new AuthError(400, "invalid_role", "Choose view, comment, suggest or edit.");
    this.db
      .prepare("UPDATE doc_shares SET role = ? WHERE doc_id = ? AND user_id = ?")
      .run(role, docId, userId);
  }

  unshare(docId: string, userId: string): void {
    this.db.prepare("DELETE FROM doc_shares WHERE doc_id = ? AND user_id = ?").run(docId, userId);
  }

  createLink(
    docId: string,
    role: DocRole,
    days: number,
    createdBy: string,
  ): { token: string; link: LinkEntry } {
    if (!isDocRole(role)) throw new AuthError(400, "invalid_role", "Choose view, comment, suggest or edit.");
    if (!(LINK_DAYS as readonly number[]).includes(days))
      throw new AuthError(400, "invalid_expiry", "Links can last 1, 7 or 30 days.");
    const token = newToken();
    const id = createId("shr");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    this.db
      .prepare(
        "INSERT INTO share_links (id, doc_id, token_hash, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, docId, hashToken(token), role, createdBy, createdAt, expiresAt);
    return { token, link: { id, role, expiresAt, createdAt } };
  }

  links(docId: string): LinkEntry[] {
    return this.db
      .prepare(
        `SELECT id, role, expires_at AS expiresAt, created_at AS createdAt FROM share_links
         WHERE doc_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
      )
      .all(docId, now()) as unknown as LinkEntry[];
  }

  revokeLink(docId: string, linkId: string): void {
    this.db
      .prepare("UPDATE share_links SET revoked_at = ? WHERE id = ? AND doc_id = ?")
      .run(now(), linkId, docId);
  }

  private liveLink(token: string) {
    return this.db
      .prepare(
        "SELECT id, doc_id, role, expires_at, created_by FROM share_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
      )
      .get(hashToken(token), now()) as
      { id: string; doc_id: string; role: DocRole; expires_at: string; created_by: string } | undefined;
  }

  linkInfo(token: string): { docId: string; role: DocRole; expiresAt: string; sharedBy: string } {
    const link = this.liveLink(token);
    if (!link) throw new AuthError(404, "link_expired", "This link has expired or was turned off.");
    return {
      docId: link.doc_id,
      role: link.role,
      expiresAt: link.expires_at,
      sharedBy: this.accounts.userById(link.created_by)?.name ?? "Someone",
    };
  }

  /** Opening a share link gives the person its role until the link expires (never less than they had). */
  redeem(token: string, user: UserRow): { docId: string; workspaceId: string; role: DocRole } {
    const link = this.liveLink(token);
    if (!link) throw new AuthError(404, "link_expired", "This link has expired or was turned off.");
    const workspaceId = this.accounts.documentWorkspace(link.doc_id)!;
    const current = this.roleFor(link.doc_id, user.id, workspaceId);
    if (rank(current) < rank(link.role))
      this.grant(link.doc_id, user.id, link.role, link.created_by, link.expires_at);
    return { docId: link.doc_id, workspaceId, role: this.roleFor(link.doc_id, user.id, workspaceId)! };
  }

  /** Documents shared with someone directly or by link (not through their own workspaces). */
  sharedWith(userId: string): Array<{
    docId: string;
    workspaceId: string;
    role: DocRole;
    sharedBy: string;
    expiresAt: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT s.doc_id, d.workspace_id, s.role, g.name AS shared_by, s.expires_at FROM doc_shares s
         JOIN documents d ON d.id = s.doc_id JOIN users g ON g.id = s.granted_by
         WHERE s.user_id = ? AND (s.expires_at IS NULL OR s.expires_at > ?) ORDER BY s.created_at DESC`,
      )
      .all(userId, now()) as Array<{
      doc_id: string;
      workspace_id: string;
      role: DocRole;
      shared_by: string;
      expires_at: string | null;
    }>;
    return rows
      .map((r) => ({
        docId: r.doc_id,
        workspaceId: r.workspace_id,
        role: this.roleFor(r.doc_id, userId, r.workspace_id) ?? r.role,
        sharedBy: r.shared_by,
        expiresAt: r.expires_at,
      }))
      .filter((r) => {
        const ws = this.accounts.roleIn(r.workspaceId, userId);
        return !ws || ws === "guest";
      });
  }

  publicToken(docId: string): string | undefined {
    return (
      this.db.prepare("SELECT token FROM public_links WHERE doc_id = ?").get(docId) as
        { token: string } | undefined
    )?.token;
  }

  setPublic(docId: string, enabled: boolean, userId: string): string | undefined {
    if (!enabled) {
      this.db.prepare("DELETE FROM public_links WHERE doc_id = ?").run(docId);
      return undefined;
    }
    const existing = this.publicToken(docId);
    if (existing) return existing;
    const token = newToken();
    this.db
      .prepare("INSERT INTO public_links (doc_id, token, created_by, created_at) VALUES (?, ?, ?, ?)")
      .run(docId, token, userId, now());
    return token;
  }

  publicDoc(token: string): string | undefined {
    return (
      this.db.prepare("SELECT doc_id FROM public_links WHERE token = ?").get(token) as
        { doc_id: string } | undefined
    )?.doc_id;
  }
}
