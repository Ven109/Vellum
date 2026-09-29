import { createId } from "@vellum/core";
import type { Db } from "../db.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto.js";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  is_admin: number;
  avatar_color: string | null;
  created_at: string;
  password_hash?: string | null;
}

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  avatarColor: string;
  createdAt: string;
}

const COLOURS = ["#9A3412", "#1D4ED8", "#047857", "#7C3AED", "#B45309", "#BE185D", "#0F766E"];
const SESSION_DAYS = 30;
const now = () => new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: !!u.is_admin,
    avatarColor: u.avatar_color ?? COLOURS[0]!,
    createdAt: u.created_at,
  };
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function checkPassword(password: string): void {
  if (password.length < 10) throw new AuthError(400, "weak_password", "Use at least 10 characters.");
  if (password.length > 256) throw new AuthError(400, "weak_password", "That password is too long.");
}

/** Accounts, sessions, workspaces, invites and instance settings. All SQL lives here. */
export class AccountService {
  constructor(private readonly db: Db) {}

  // Instance ---------------------------------------------------------------------------------------
  setting(key: string): string | undefined {
    return (
      this.db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }
  setupRequired(): boolean {
    return !this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
  }
  signupsEnabled(): boolean {
    return this.setting("signups_enabled") !== "false";
  }

  // Users ------------------------------------------------------------------------------------------
  userById(id: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
  }
  userByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as unknown as
      UserRow | undefined;
  }

  async createUser(input: {
    email: string;
    name: string;
    password?: string;
    isAdmin?: boolean;
  }): Promise<UserRow> {
    const email = input.email.trim().toLowerCase();
    if (!validEmail(email)) throw new AuthError(400, "invalid_email", "Enter a valid email address.");
    if (!input.name.trim()) throw new AuthError(400, "invalid_name", "Enter your name.");
    if (this.userByEmail(email))
      throw new AuthError(409, "email_taken", "An account with that email already exists.");
    if (input.password !== undefined) checkPassword(input.password);
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    const row: UserRow = {
      id: createId("usr"),
      email,
      name: input.name.trim().slice(0, 80),
      is_admin: input.isAdmin ? 1 : 0,
      avatar_color: COLOURS[count % COLOURS.length]!,
      created_at: now(),
      password_hash: input.password ? await hashPassword(input.password) : null,
    };
    this.db
      .prepare(
        "INSERT INTO users (id, email, name, password_hash, is_admin, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.email,
        row.name,
        row.password_hash ?? null,
        row.is_admin,
        row.avatar_color,
        row.created_at,
      );
    return row;
  }

  async authenticate(email: string, password: string): Promise<UserRow> {
    const user = this.userByEmail(email);
    // Always spend the hashing time so response timing doesn't reveal which emails exist.
    const ok = user?.password_hash
      ? await verifyPassword(password, user.password_hash)
      : (await hashPassword(password), false);
    if (!user || !ok) throw new AuthError(401, "invalid_credentials", "Email or password is incorrect.");
    return user;
  }

  updateName(userId: string, name: string): void {
    if (!name.trim()) throw new AuthError(400, "invalid_name", "Enter your name.");
    this.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.trim().slice(0, 80), userId);
  }

  // Sessions ---------------------------------------------------------------------------------------
  createSession(userId: string): string {
    const token = newToken();
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), userId, now(), inDays(SESSION_DAYS));
    return token;
  }
  userForSession(token: string | undefined): UserRow | undefined {
    if (!token) return undefined;
    return this.db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
      )
      .get(hashToken(token), now()) as unknown as UserRow | undefined;
  }
  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  deleteSessionsFor(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  // Password reset ---------------------------------------------------------------------------------
  createPasswordReset(email: string): { token: string; user: UserRow } | null {
    const user = this.userByEmail(email);
    if (!user) return null;
    const token = newToken();
    this.db
      .prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), user.id, inHours(1));
    return { token, user };
  }
  async resetPassword(token: string, password: string): Promise<UserRow> {
    checkPassword(password);
    const row = this.db
      .prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?")
      .get(hashToken(token), now()) as unknown as { user_id: string } | undefined;
    if (!row) throw new AuthError(400, "invalid_token", "This reset link is invalid or has expired.");
    this.db.prepare("UPDATE password_resets SET used = 1 WHERE token_hash = ?").run(hashToken(token));
    this.db
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(await hashPassword(password), row.user_id);
    this.deleteSessionsFor(row.user_id); // sign out everywhere
    return this.userById(row.user_id)!;
  }

  // OAuth ------------------------------------------------------------------------------------------
  userForOAuth(provider: string, providerUserId: string): UserRow | undefined {
    return this.db
      .prepare(
        "SELECT u.* FROM oauth_accounts o JOIN users u ON u.id = o.user_id WHERE o.provider = ? AND o.provider_user_id = ?",
      )
      .get(provider, providerUserId) as unknown as UserRow | undefined;
  }
  linkOAuth(provider: string, providerUserId: string, userId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id) VALUES (?, ?, ?)")
      .run(provider, providerUserId, userId);
  }

  // Workspaces -------------------------------------------------------------------------------------
  createWorkspace(name: string, ownerId: string, id: string = createId("wsp")): { id: string; name: string } {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) throw new AuthError(400, "invalid_name", "Name your workspace.");
    this.db
      .prepare("INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
      .run(id, trimmed, ownerId, now());
    this.db
      .prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
      .run(id, ownerId, now());
    return { id, name: trimmed };
  }
  workspacesFor(userId: string): Array<{ id: string; name: string; role: WorkspaceRole }> {
    return this.db
      .prepare(
        "SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at",
      )
      .all(userId) as Array<{ id: string; name: string; role: WorkspaceRole }>;
  }
  roleIn(workspaceId: string, userId: string): WorkspaceRole | undefined {
    return (
      this.db
        .prepare("SELECT role FROM members WHERE workspace_id = ? AND user_id = ?")
        .get(workspaceId, userId) as { role: WorkspaceRole } | undefined
    )?.role;
  }
  renameWorkspace(workspaceId: string, name: string): void {
    this.db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name.trim().slice(0, 80), workspaceId);
  }
  members(workspaceId: string): Array<PublicUser & { role: WorkspaceRole; joinedAt: string }> {
    const rows = this.db
      .prepare(
        "SELECT u.*, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.joined_at",
      )
      .all(workspaceId) as unknown as Array<UserRow & { role: WorkspaceRole; joined_at: string }>;
    return rows.map((r) => ({ ...toPublic(r), role: r.role, joinedAt: r.joined_at }));
  }
  setRole(workspaceId: string, userId: string, role: WorkspaceRole): void {
    if (
      role !== "owner" &&
      this.roleIn(workspaceId, userId) === "owner" &&
      this.ownerCount(workspaceId) === 1
    )
      throw new AuthError(400, "last_owner", "A workspace needs at least one owner.");
    this.db
      .prepare("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?")
      .run(role, workspaceId, userId);
  }
  removeMember(workspaceId: string, userId: string): void {
    if (this.roleIn(workspaceId, userId) === "owner" && this.ownerCount(workspaceId) === 1)
      throw new AuthError(400, "last_owner", "A workspace needs at least one owner.");
    this.db.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
  }
  private ownerCount(workspaceId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'")
        .get(workspaceId) as { n: number }
    ).n;
  }

  // Invites ----------------------------------------------------------------------------------------
  createInvite(workspaceId: string, email: string, role: WorkspaceRole, invitedBy: string): string {
    if (!validEmail(email)) throw new AuthError(400, "invalid_email", "Enter a valid email address.");
    if (role === "owner") throw new AuthError(400, "invalid_role", "Invite as admin, member or guest.");
    const token = newToken();
    this.db
      .prepare(
        "INSERT INTO invites (token_hash, workspace_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(hashToken(token), workspaceId, email.trim().toLowerCase(), role, invitedBy, now(), inDays(14));
    return token;
  }
  invite(
    token: string,
  ):
    | { workspaceId: string; workspaceName: string; email: string; role: WorkspaceRole; invitedBy: string }
    | undefined {
    return this.db
      .prepare(
        `SELECT i.workspace_id AS workspaceId, w.name AS workspaceName, i.email, i.role, u.name AS invitedBy
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.invited_by
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`,
      )
      .get(hashToken(token), now()) as unknown as ReturnType<AccountService["invite"]>;
  }
  acceptInvite(token: string, userId: string): string {
    const inv = this.invite(token);
    if (!inv) throw new AuthError(400, "invalid_invite", "This invite is invalid or has expired.");
    if (!this.roleIn(inv.workspaceId, userId))
      this.db
        .prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)")
        .run(inv.workspaceId, userId, inv.role, now());
    this.db.prepare("UPDATE invites SET accepted_at = ? WHERE token_hash = ?").run(now(), hashToken(token));
    return inv.workspaceId;
  }
  pendingInvites(workspaceId: string): Array<{ email: string; role: string; createdAt: string }> {
    return this.db
      .prepare(
        "SELECT email, role, created_at AS createdAt FROM invites WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
      )
      .all(workspaceId, now()) as Array<{ email: string; role: string; createdAt: string }>;
  }

  // Document registry ------------------------------------------------------------------------------
  documentWorkspace(docId: string): string | undefined {
    return (
      this.db.prepare("SELECT workspace_id FROM documents WHERE id = ?").get(docId) as
        { workspace_id: string } | undefined
    )?.workspace_id;
  }
  /**
   * Documents registered to a workspace, with `version`: the sequence number of the latest stored update,
   * so clients can tell which documents changed since they last synced without opening each one.
   */
  workspaceDocuments(
    workspaceId: string,
  ): Array<{ id: string; createdBy: string; createdAt: string; version: number }> {
    return this.db
      .prepare(
        `SELECT d.id, d.created_by AS createdBy, d.created_at AS createdAt,
                COALESCE((SELECT MAX(seq) FROM doc_updates u WHERE u.doc_id = d.id), 0) AS version
           FROM documents d WHERE d.workspace_id = ? ORDER BY d.created_at`,
      )
      .all(workspaceId) as unknown as Array<{
      id: string;
      createdBy: string;
      createdAt: string;
      version: number;
    }>;
  }
  registerDocument(docId: string, workspaceId: string, userId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO documents (id, workspace_id, created_by, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(docId, workspaceId, userId, now());
  }
}
