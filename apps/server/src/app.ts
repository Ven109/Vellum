import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "./config.js";
import { openDatabase } from "./db.js";
import type { Db } from "./db.js";
import { DocStore } from "./doc-store.js";
import { RoomManager } from "./rooms.js";
import { authPlugin } from "./auth/routes.js";
import { AccountService } from "./auth/service.js";
import type { UserRow } from "./auth/service.js";
import { createMailer } from "./mail.js";

export interface AppContext {
  config: ServerConfig;
  db: Db;
  docs: DocStore;
  rooms: RoomManager;
  accounts: AccountService;
}

/**
 * Who may open a sync room. Workspace rooms (`wsp_…`) need membership. Document rooms need membership
 * of the document's workspace; a new document is registered to the workspace named in `?ws=` the first
 * time a member (not a guest) opens it.
 */
export function canAccessRoom(
  accounts: AccountService,
  user: UserRow,
  roomId: string,
  wsHint?: string,
): boolean {
  if (roomId.startsWith("wsp_")) return !!accounts.roleIn(roomId, user.id);
  const ws = accounts.documentWorkspace(roomId);
  if (ws) return !!accounts.roleIn(ws, user.id);
  if (!wsHint) return false;
  const role = accounts.roleIn(wsHint, user.id);
  if (!role || role === "guest") return false;
  accounts.registerDocument(roomId, wsHint, user.id);
  return true;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export const DOC_ID = /^[a-z]{3}_[0-9a-z]{10,40}$/;

export async function buildApp(
  config: ServerConfig,
  opts: { db?: Db; logger?: boolean; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 10 * 1024 * 1024,
  });
  const db = opts.db ?? openDatabase(config.dataDir);
  const docs = new DocStore(db);
  const rooms = new RoomManager(docs);
  const accounts = new AccountService(db);
  app.decorate("ctx", { config, db, docs, rooms, accounts });

  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 * 1024 } });
  authPlugin(app, {
    accounts,
    mailer: createMailer(opts.env ?? process.env, app.log),
    publicUrl: config.publicUrl.replace(/\/+$/, ""),
    env: opts.env ?? process.env,
    fetchImpl: opts.fetchImpl,
  });

  app.get("/api/health", async () => ({
    ok: true,
    name: "vellum",
    version: process.env.VELLUM_VERSION ?? "dev",
  }));

  app.get<{ Params: { docId: string }; Querystring: { ws?: string } }>(
    "/sync/:docId",
    { websocket: true },
    (socket, req) => {
      const { docId } = req.params;
      if (!DOC_ID.test(docId)) {
        socket.close(4400, "invalid document id");
        return;
      }
      if (!req.user) {
        socket.close(4401, "sign in required");
        return;
      }
      if (!canAccessRoom(accounts, req.user, docId, req.query.ws)) {
        socket.close(4403, "no access");
        return;
      }
      const handle = rooms.join(docId, {
        send: (data) => {
          if (socket.readyState === socket.OPEN) socket.send(data);
        },
        close: () => socket.close(1001, "server shutting down"),
      });
      socket.binaryType = "arraybuffer";
      // Process messages strictly in order: acks must follow persistence of the update they cover.
      let queue = Promise.resolve();
      socket.on("message", (data: ArrayBuffer | Buffer) => {
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        queue = queue
          .then(() => handle.receive(bytes))
          .catch((err: unknown) => {
            req.log.warn({ err, docId }, "bad sync message");
            socket.close(4400, "bad message");
          });
      });
      socket.on("close", () => handle.leave());
    },
  );

  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    // Single-page app: unknown non-API routes serve index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/sync/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  app.addHook("onClose", async () => {
    rooms.closeAll();
    if (!opts.db) db.close();
  });

  return app;
}
