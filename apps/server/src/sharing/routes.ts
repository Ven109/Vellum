import type { FastifyInstance, FastifyRequest } from "fastify";
import type * as Y from "yjs";
import type { DocStore } from "../doc-store.js";
import type { RoomManager } from "../rooms.js";
import { AuthError } from "../auth/service.js";
import type { AccountService, UserRow } from "../auth/service.js";
import { publicPage, renderDocument } from "./render.js";
import { isDocRole } from "./service.js";
import type { DocRole, SharingService } from "./service.js";

interface Deps {
  accounts: AccountService;
  sharing: SharingService;
  rooms: RoomManager;
  docs: DocStore;
  publicUrl: string;
}

const DOC_ID = /^doc_[0-9a-z]{10,40}$/;

/** Share dialog, share links, "shared with me" and public read-only pages. */
export function sharingPlugin(app: FastifyInstance, deps: Deps): void {
  const { accounts, sharing, rooms, docs, publicUrl } = deps;

  const requireUser = (req: FastifyRequest): UserRow => {
    if (!req.user) throw new AuthError(401, "unauthenticated", "Sign in to continue.");
    return req.user;
  };
  const docParam = (id: string) => {
    if (!DOC_ID.test(id)) throw new AuthError(404, "not_found", "No such document.");
    return id;
  };
  /** Read a document without keeping a room open. */
  const withDoc = <T>(docId: string, fn: (doc: Y.Doc) => T): T => {
    const open = rooms.peek(docId);
    if (open) return fn(open);
    const doc = docs.load(docId);
    try {
      return fn(doc);
    } finally {
      doc.destroy();
    }
  };
  const titleOf = (docId: string) => withDoc(docId, (d) => d.getText("title").toString()) || "Untitled";
  const titleCache = new Map<string, { version: number; title: string }>();

  const sharingState = (docId: string) => {
    const workspaceId = accounts.documentWorkspace(docId)!;
    const token = sharing.publicToken(docId);
    return {
      workspace: {
        id: workspaceId,
        members: accounts
          .members(workspaceId)
          .filter((m) => m.role !== "guest")
          .map((m) => ({ id: m.id, name: m.name, email: m.email, avatarColor: m.avatarColor })),
      },
      people: sharing.shares(docId),
      links: sharing.links(docId),
      publicUrl: token ? `${publicUrl}/p/${token}` : null,
    };
  };

  app.get<{ Params: { id: string } }>("/api/documents/:id/access", async (req) => {
    const user = requireUser(req);
    const docId = docParam(req.params.id);
    const workspaceId = accounts.documentWorkspace(docId);
    if (!workspaceId) return { role: null, registered: false };
    return { role: sharing.roleFor(docId, user.id, workspaceId) ?? null, registered: true, workspaceId };
  });

  app.get<{ Params: { id: string } }>("/api/documents/:id/sharing", async (req) => {
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, requireUser(req), "edit");
    return sharingState(docId);
  });

  app.post<{ Params: { id: string }; Body: { email: string; role: DocRole } }>(
    "/api/documents/:id/shares",
    async (req) => {
      const user = requireUser(req);
      const docId = docParam(req.params.id);
      sharing.requireRole(docId, user, "edit");
      sharing.share(docId, String(req.body.email ?? ""), req.body.role, user.id);
      return sharingState(docId);
    },
  );

  app.patch<{ Params: { id: string; userId: string }; Body: { role: DocRole } }>(
    "/api/documents/:id/shares/:userId",
    async (req) => {
      const docId = docParam(req.params.id);
      sharing.requireRole(docId, requireUser(req), "edit");
      sharing.setShareRole(docId, req.params.userId, req.body.role);
      return sharingState(docId);
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>("/api/documents/:id/shares/:userId", async (req) => {
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, requireUser(req), "edit");
    sharing.unshare(docId, req.params.userId);
    return sharingState(docId);
  });

  app.post<{ Params: { id: string }; Body: { role: DocRole; days: number } }>(
    "/api/documents/:id/links",
    async (req) => {
      const user = requireUser(req);
      const docId = docParam(req.params.id);
      sharing.requireRole(docId, user, "edit");
      const { token, link } = sharing.createLink(docId, req.body.role, Number(req.body.days), user.id);
      return { url: `${publicUrl}/s/${token}`, link, state: sharingState(docId) };
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>("/api/documents/:id/links/:linkId", async (req) => {
    const docId = docParam(req.params.id);
    sharing.requireRole(docId, requireUser(req), "edit");
    sharing.revokeLink(docId, req.params.linkId);
    return sharingState(docId);
  });

  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/documents/:id/public",
    async (req) => {
      const user = requireUser(req);
      const docId = docParam(req.params.id);
      sharing.requireRole(docId, user, "edit");
      sharing.setPublic(docId, req.body.enabled === true, user.id);
      return sharingState(docId);
    },
  );

  app.get<{ Params: { token: string } }>("/api/share-links/:token", async (req) => {
    const info = sharing.linkInfo(req.params.token);
    return {
      title: titleOf(info.docId),
      role: info.role,
      expiresAt: info.expiresAt,
      sharedBy: info.sharedBy,
    };
  });

  app.post<{ Params: { token: string } }>("/api/share-links/:token/open", async (req) => {
    const r = sharing.redeem(req.params.token, requireUser(req));
    return { documentId: r.docId, workspaceId: r.workspaceId, role: r.role, title: titleOf(r.docId) };
  });

  // Every document registered to a workspace, so a new device can list (and then sync) them.
  app.get<{ Params: { id: string } }>("/api/workspaces/:id/documents", async (req) => {
    const user = requireUser(req);
    const role = accounts.roleIn(req.params.id, user.id);
    if (!role || role === "guest") throw new AuthError(403, "forbidden", "You don't have access to that.");
    // Titles live in each document's CRDT; loading one is costly, so reuse it until the document changes.
    return accounts.workspaceDocuments(req.params.id).map((d) => {
      const cached = titleCache.get(d.id);
      if (cached && cached.version === d.version) return { ...d, title: cached.title };
      const title = titleOf(d.id);
      titleCache.set(d.id, { version: d.version, title });
      return { ...d, title };
    });
  });

  app.get("/api/shared", async (req) => {
    const user = requireUser(req);
    return sharing.sharedWith(user.id).map((s) => ({ ...s, title: titleOf(s.docId) }));
  });

  // Public read-only page for a published piece: plain HTML, no scripts, no sign-in.
  app.get<{ Params: { token: string } }>("/p/:token", async (req, reply) => {
    const docId = /^[A-Za-z0-9_-]{20,}$/.test(req.params.token)
      ? sharing.publicDoc(req.params.token)
      : undefined;
    if (!docId)
      return reply
        .code(404)
        .type("text/html")
        .send(publicPage("Not found", "<p>This page isn't published.</p>"));
    const { title, html } = withDoc(docId, renderDocument);
    return reply
      .type("text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'",
      )
      .header("x-robots-tag", "noindex")
      .send(publicPage(title, html));
  });

  app.decorate("sharing", sharing);
}

declare module "fastify" {
  interface FastifyInstance {
    sharing: SharingService;
  }
}

export { isDocRole };
