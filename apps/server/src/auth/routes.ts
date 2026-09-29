import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hashToken, newToken } from "./crypto.js";
import { exchangeCode, oauthProviders } from "./oauth.js";
import { AuthError, toPublic } from "./service.js";
import type { AccountService, UserRow, WorkspaceRole } from "./service.js";
import type { Mailer } from "../mail.js";

export const SESSION_COOKIE = "vellum_session";

/** The session token from the cookie, an `Authorization: Bearer` header, or a WebSocket's ?access_token. */
export function sessionToken(req: FastifyRequest): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
  if (bearer) return bearer;
  if (req.url.startsWith("/sync/")) {
    const q = new URL(req.url, "http://x").searchParams.get("access_token");
    if (q) return q;
  }
  return req.cookies[SESSION_COOKIE];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
  }
}

/** Tiny in-memory rate limiter for credential endpoints (per IP + key). */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  check(key: string): void {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max)
      throw new AuthError(429, "rate_limited", "Too many attempts. Wait a minute and try again.");
    recent.push(now);
    this.hits.set(key, recent);
  }
}

export interface AuthDeps {
  accounts: AccountService;
  mailer: Mailer;
  publicUrl: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "guest"];

export function authPlugin(app: FastifyInstance, deps: AuthDeps): void {
  const { accounts, mailer, publicUrl } = deps;
  const secure = publicUrl.startsWith("https://");
  const limiter = new Limiter(10, 60_000);
  const providers = oauthProviders(deps.env);
  const f = deps.fetchImpl ?? fetch;

  /**
   * Start a session: a cookie for the web app, and — for apps on another origin such as the desktop app,
   * which ask with `x-vellum-token: 1` — the token itself, to send as a bearer token.
   */
  const setSession = (req: FastifyRequest, reply: FastifyReply, userId: string): { token?: string } => {
    const token = accounts.createSession(userId);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 30 * 86_400,
    });
    return req.headers["x-vellum-token"] === "1" ? { token } : {};
  };

  // Resolve the session on every request: cookie, bearer token, or (WebSocket only) ?access_token=.
  app.addHook("onRequest", async (req) => {
    req.user = accounts.userForSession(sessionToken(req));
  });

  // Browsers can't send application/json cross-site without a CORS preflight, which we never grant:
  // requiring it on state-changing API calls blocks CSRF alongside SameSite=Lax cookies.
  app.addHook("preHandler", async (req) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
      req.url.startsWith("/api/") &&
      !req.url.startsWith("/api/auth/oauth/")
    ) {
      const type = req.headers["content-type"] ?? "";
      // Uploads send the file itself; a custom header needs a preflight just as JSON does.
      const upload = req.url === "/api/uploads" && req.headers["x-vellum-upload"] === "1";
      if (!type.startsWith("application/json") && !upload)
        throw new AuthError(415, "json_required", "Requests must be JSON.");
    }
  });

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AuthError)
      return reply.code(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply
      .code(status)
      .send({ error: "error", message: status >= 500 ? "Something went wrong." : err.message });
  });

  const requireUser = (req: FastifyRequest): UserRow => {
    if (!req.user) throw new AuthError(401, "unauthenticated", "Sign in to continue.");
    return req.user;
  };
  const requireRole = (req: FastifyRequest, workspaceId: string, allowed: WorkspaceRole[]) => {
    const user = requireUser(req);
    const role = accounts.roleIn(workspaceId, user.id);
    if (!role || !allowed.includes(role))
      throw new AuthError(403, "forbidden", "You don't have access to that.");
    return { user, role };
  };

  const me = (user: UserRow) => ({ user: toPublic(user), workspaces: accounts.workspacesFor(user.id) });

  app.get("/api/instance", async () => ({
    setupRequired: accounts.setupRequired(),
    signupsEnabled: accounts.signupsEnabled(),
    oauth: providers.map((p) => ({ id: p.id, label: p.label })),
    mail: mailer.configured,
    // Self-hosters can require that voice sessions keep all audio on the writer's machine.
    voice: { localOnly: /^(1|true|yes)$/i.test(deps.env.VELLUM_VOICE_LOCAL_ONLY ?? "") },
  }));

  app.post<{
    Body: { email: string; name: string; password: string; workspaceName?: string; signupsEnabled?: boolean };
  }>("/api/setup", async (req, reply) => {
    if (!accounts.setupRequired())
      throw new AuthError(409, "already_set_up", "This instance is already set up.");
    const b = req.body;
    const user = await accounts.createUser({
      email: b.email,
      name: b.name,
      password: b.password,
      isAdmin: true,
    });
    accounts.setSetting("signups_enabled", String(b.signupsEnabled ?? false));
    accounts.createWorkspace(b.workspaceName || `${user.name}'s workspace`, user.id);
    const session = setSession(req, reply, user.id);
    return { ...me(user), ...session };
  });

  app.post<{ Body: { email: string; name: string; password: string; invite?: string } }>(
    "/api/auth/signup",
    async (req, reply) => {
      limiter.check(`signup:${req.ip}`);
      const b = req.body;
      const invite = b.invite ? accounts.invite(b.invite) : undefined;
      if (accounts.setupRequired())
        throw new AuthError(409, "setup_required", "This instance hasn't been set up yet.");
      if (!accounts.signupsEnabled() && !invite)
        throw new AuthError(403, "signups_disabled", "Sign-up is invite-only on this instance.");
      const user = await accounts.createUser({ email: b.email, name: b.name, password: b.password });
      if (invite && b.invite) accounts.acceptInvite(b.invite, user.id);
      else accounts.createWorkspace(`${user.name}'s workspace`, user.id);
      const session = setSession(req, reply, user.id);
      return { ...me(user), ...session };
    },
  );

  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (req, reply) => {
    limiter.check(`login:${req.ip}:${String(req.body.email).toLowerCase()}`);
    const user = await accounts.authenticate(req.body.email, req.body.password);
    const session = setSession(req, reply, user.id);
    return { ...me(user), ...session };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = sessionToken(req);
    if (token) accounts.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => me(requireUser(req)));

  app.patch<{ Body: { name: string } }>("/api/auth/me", async (req) => {
    const user = requireUser(req);
    accounts.updateName(user.id, req.body.name);
    return me(accounts.userById(user.id)!);
  });

  app.post<{ Body: { email: string } }>("/api/auth/password/forgot", async (req) => {
    limiter.check(`forgot:${req.ip}`);
    const reset = accounts.createPasswordReset(String(req.body.email ?? ""));
    if (reset) {
      await mailer.send(
        reset.user.email,
        "Reset your Vellum password",
        `Someone asked to reset the password for ${reset.user.email}.\n\nReset it here (valid for one hour):\n${publicUrl}/reset-password?token=${reset.token}\n\nIf this wasn't you, ignore this email.`,
      );
    }
    // Same answer whether or not the account exists.
    return { ok: true };
  });

  app.post<{ Body: { token: string; password: string } }>("/api/auth/password/reset", async (req, reply) => {
    const user = await accounts.resetPassword(req.body.token, req.body.password);
    const session = setSession(req, reply, user.id);
    return { ...me(user), ...session };
  });

  // OAuth --------------------------------------------------------------------------------------------
  app.get<{ Params: { provider: string } }>("/api/auth/oauth/:provider/start", async (req, reply) => {
    const p = providers.find((x) => x.id === req.params.provider);
    if (!p) throw new AuthError(404, "unknown_provider", "That sign-in method isn't enabled.");
    const state = newToken();
    reply.setCookie("vellum_oauth_state", hashToken(state), {
      path: "/api/auth/oauth",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 600,
    });
    const url = new URL(p.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: p.clientId,
      redirect_uri: `${publicUrl}/api/auth/oauth/${p.id}/callback`,
      scope: p.scope,
      state,
      response_type: "code",
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    "/api/auth/oauth/:provider/callback",
    async (req, reply) => {
      const p = providers.find((x) => x.id === req.params.provider);
      const fail = (reason: string) =>
        reply.redirect(`${publicUrl}/sign-in?error=${encodeURIComponent(reason)}`);
      if (!p || !req.query.code || !req.query.state) return fail("oauth_failed");
      if (req.cookies.vellum_oauth_state !== hashToken(req.query.state)) return fail("oauth_state");
      reply.clearCookie("vellum_oauth_state", { path: "/api/auth/oauth" });
      const token = await exchangeCode(p, req.query.code, `${publicUrl}/api/auth/oauth/${p.id}/callback`, f);
      const profile = token ? await p.profile(token, f) : null;
      if (!profile) return fail("oauth_profile");
      let user = accounts.userForOAuth(p.id, profile.id) ?? accounts.userByEmail(profile.email);
      if (!user) {
        if (accounts.setupRequired() || !accounts.signupsEnabled()) return fail("signups_disabled");
        user = await accounts.createUser({ email: profile.email, name: profile.name });
        accounts.createWorkspace(`${user.name}'s workspace`, user.id);
      }
      accounts.linkOAuth(p.id, profile.id, user.id);
      setSession(req, reply, user.id);
      return reply.redirect(`${publicUrl}/`);
    },
  );

  // Workspaces -----------------------------------------------------------------------------------
  app.get("/api/workspaces", async (req) => accounts.workspacesFor(requireUser(req).id));

  app.post<{ Body: { name: string; id?: string } }>("/api/workspaces", async (req) => {
    const user = requireUser(req);
    const id = req.body.id && /^wsp_[0-9a-z]{26}$/.test(req.body.id) ? req.body.id : undefined;
    return accounts.createWorkspace(req.body.name, user.id, id);
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>("/api/workspaces/:id", async (req) => {
    requireRole(req, req.params.id, ["owner", "admin"]);
    accounts.renameWorkspace(req.params.id, req.body.name);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/workspaces/:id/members", async (req) => {
    requireRole(req, req.params.id, ROLES);
    return { members: accounts.members(req.params.id), invites: accounts.pendingInvites(req.params.id) };
  });

  app.patch<{ Params: { id: string; userId: string }; Body: { role: WorkspaceRole } }>(
    "/api/workspaces/:id/members/:userId",
    async (req) => {
      requireRole(req, req.params.id, ["owner", "admin"]);
      if (!ROLES.includes(req.body.role)) throw new AuthError(400, "invalid_role", "Unknown role.");
      accounts.setRole(req.params.id, req.params.userId, req.body.role);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/workspaces/:id/members/:userId",
    async (req) => {
      const { user } = requireRole(req, req.params.id, ROLES);
      // Anyone may leave; removing others needs owner/admin.
      if (req.params.userId !== user.id) requireRole(req, req.params.id, ["owner", "admin"]);
      accounts.removeMember(req.params.id, req.params.userId);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { email: string; role?: WorkspaceRole } }>(
    "/api/workspaces/:id/invites",
    async (req) => {
      const { user } = requireRole(req, req.params.id, ["owner", "admin", "member"]);
      const role = req.body.role ?? "member";
      const token = accounts.createInvite(req.params.id, req.body.email, role, user.id);
      const link = `${publicUrl}/invite/${token}`;
      const ws = accounts.workspacesFor(user.id).find((w) => w.id === req.params.id);
      await mailer.send(
        req.body.email,
        `${user.name} invited you to ${ws?.name ?? "a workspace"} on Vellum`,
        `Join here:\n${link}\n\nThis invite expires in 14 days.`,
      );
      return { link, emailed: mailer.configured };
    },
  );

  app.get<{ Params: { token: string } }>("/api/invites/:token", async (req) => {
    const inv = accounts.invite(req.params.token);
    if (!inv) throw new AuthError(404, "invalid_invite", "This invite is invalid or has expired.");
    return { workspaceName: inv.workspaceName, email: inv.email, role: inv.role, invitedBy: inv.invitedBy };
  });

  app.post<{ Params: { token: string } }>("/api/invites/:token/accept", async (req) => {
    const user = requireUser(req);
    return { workspaceId: accounts.acceptInvite(req.params.token, user.id) };
  });

  // Instance administration ------------------------------------------------------------------------
  app.get("/api/admin/settings", async (req) => {
    const user = requireUser(req);
    if (!user.is_admin) throw new AuthError(403, "forbidden", "Admins only.");
    return { signupsEnabled: accounts.signupsEnabled() };
  });

  app.patch<{ Body: { signupsEnabled: boolean } }>("/api/admin/settings", async (req) => {
    const user = requireUser(req);
    if (!user.is_admin) throw new AuthError(403, "forbidden", "Admins only.");
    accounts.setSetting("signups_enabled", String(!!req.body.signupsEnabled));
    return { signupsEnabled: accounts.signupsEnabled() };
  });

  // Document registry ------------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { documentId: string } }>(
    "/api/workspaces/:id/documents",
    async (req) => {
      const { user } = requireRole(req, req.params.id, ["owner", "admin", "member"]);
      const existing = accounts.documentWorkspace(req.body.documentId);
      if (existing && existing !== req.params.id)
        throw new AuthError(409, "conflict", "That document belongs to another workspace.");
      accounts.registerDocument(req.body.documentId, req.params.id, user.id);
      return { ok: true };
    },
  );
}
