import { serverBaseUrl } from "./server.js";

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  avatarColor: string;
  createdAt: string;
}

export interface AccountWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface Me {
  user: AccountUser;
  workspaces: AccountWorkspace[];
}

export interface InstanceInfo {
  setupRequired: boolean;
  signupsEnabled: boolean;
  oauth: Array<{ id: string; label: string }>;
  mail: boolean;
}

export interface Member extends AccountUser {
  role: WorkspaceRole;
  joinedAt: string;
}

export interface PendingInvite {
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

export type DocRole = "view" | "comment" | "suggest" | "edit";

export interface SharedDoc {
  docId: string;
  workspaceId: string;
  title: string;
  role: DocRole;
  sharedBy: string;
  expiresAt: string | null;
}

export interface SharePerson {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: DocRole;
  expiresAt: string | null;
}

export interface ShareLink {
  id: string;
  role: DocRole;
  expiresAt: string;
  createdAt: string;
}

export interface SharingState {
  workspace: { id: string; members: Array<{ id: string; name: string; email: string; avatarColor: string }> };
  people: SharePerson[];
  links: ShareLink[];
  publicUrl: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON request to the Vellum server with the session cookie. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  // State-changing requests must be JSON (the server's CSRF guard), including DELETE.
  if (body === undefined && method !== "GET") body = {};
  const res = await fetch(`${serverBaseUrl()}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.code ?? "error",
      data.message ?? (res.status >= 500 ? "The server had a problem. Try again." : "Request failed."),
    );
  }
  return data as T;
}

export const account = {
  instance: () => api<InstanceInfo>("GET", "/api/instance"),
  me: () => api<Me>("GET", "/api/auth/me"),
  setup: (b: {
    email: string;
    name: string;
    password: string;
    workspaceName?: string;
    signupsEnabled?: boolean;
  }) => api<Me>("POST", "/api/setup", b),
  signup: (b: { email: string; name: string; password: string; invite?: string }) =>
    api<Me>("POST", "/api/auth/signup", b),
  login: (b: { email: string; password: string }) => api<Me>("POST", "/api/auth/login", b),
  logout: () => api<{ ok: true }>("POST", "/api/auth/logout", {}),
  rename: (name: string) => api<Me>("PATCH", "/api/auth/me", { name }),
  forgot: (email: string) => api<{ ok: true }>("POST", "/api/auth/password/forgot", { email }),
  reset: (token: string, password: string) =>
    api<Me>("POST", "/api/auth/password/reset", { token, password }),
  oauthStartUrl: (provider: string) =>
    `${serverBaseUrl()}/api/auth/oauth/${encodeURIComponent(provider)}/start`,
  createWorkspace: (name: string) => api<{ id: string; name: string }>("POST", "/api/workspaces", { name }),
  renameWorkspace: (id: string, name: string) =>
    api<{ ok: true }>("PATCH", `/api/workspaces/${id}`, { name }),
  members: (id: string) =>
    api<{ members: Member[]; invites: PendingInvite[] }>("GET", `/api/workspaces/${id}/members`),
  setRole: (id: string, userId: string, role: WorkspaceRole) =>
    api<{ ok: true }>("PATCH", `/api/workspaces/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    api<{ ok: true }>("DELETE", `/api/workspaces/${id}/members/${userId}`),
  invite: (id: string, email: string, role: WorkspaceRole) =>
    api<{ link: string; emailed: boolean }>("POST", `/api/workspaces/${id}/invites`, { email, role }),
  inviteInfo: (token: string) =>
    api<{ workspaceName: string; email: string; role: WorkspaceRole; invitedBy: string }>(
      "GET",
      `/api/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    api<{ workspaceId: string }>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, {}),
  access: (docId: string) =>
    api<{ role: DocRole | null; registered: boolean; workspaceId?: string }>(
      "GET",
      `/api/documents/${docId}/access`,
    ),
  sharing: (docId: string) => api<SharingState>("GET", `/api/documents/${docId}/sharing`),
  share: (docId: string, email: string, role: DocRole) =>
    api<SharingState>("POST", `/api/documents/${docId}/shares`, { email, role }),
  setShareRole: (docId: string, userId: string, role: DocRole) =>
    api<SharingState>("PATCH", `/api/documents/${docId}/shares/${userId}`, { role }),
  unshare: (docId: string, userId: string) =>
    api<SharingState>("DELETE", `/api/documents/${docId}/shares/${userId}`),
  createLink: (docId: string, role: DocRole, days: number) =>
    api<{ url: string; link: ShareLink; state: SharingState }>("POST", `/api/documents/${docId}/links`, {
      role,
      days,
    }),
  revokeLink: (docId: string, linkId: string) =>
    api<SharingState>("DELETE", `/api/documents/${docId}/links/${linkId}`),
  setPublic: (docId: string, enabled: boolean) =>
    api<SharingState>("PUT", `/api/documents/${docId}/public`, { enabled }),
  linkInfo: (token: string) =>
    api<{ title: string; role: DocRole; expiresAt: string; sharedBy: string }>(
      "GET",
      `/api/share-links/${encodeURIComponent(token)}`,
    ),
  openLink: (token: string) =>
    api<{ documentId: string; workspaceId: string; role: DocRole; title: string }>(
      "POST",
      `/api/share-links/${encodeURIComponent(token)}/open`,
    ),
  shared: () => api<SharedDoc[]>("GET", "/api/shared"),
  adminSettings: () => api<{ signupsEnabled: boolean }>("GET", "/api/admin/settings"),
  setAdminSettings: (b: { signupsEnabled: boolean }) =>
    api<{ signupsEnabled: boolean }>("PATCH", "/api/admin/settings", b),
};
