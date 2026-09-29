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
import { corsPlugin } from "./cors.js";
import { createMailer } from "./mail.js";
import { ReadOnlyError } from "./sharing/guard.js";
import { sharingPlugin } from "./sharing/routes.js";
import { historyPlugin } from "./history/routes.js";
import { createBlobStore } from "./storage.js";
import type { BlobStore } from "./storage.js";
import { uploadsPlugin } from "./uploads.js";
import { SharingService, WRITABLE_ROOTS } from "./sharing/service.js";
import type { DocRole } from "./sharing/service.js";

export interface AppContext {
  config: ServerConfig;
  db: Db;
  docs: DocStore;
  rooms: RoomManager;
  accounts: AccountService;
  sharing: SharingService;
}

/**
 * Someone's role in a sync room, or undefined for no access. Workspace rooms (`wsp_…`) need membership.
 * Document rooms use the document's workspace and any shares; a new document is registered to the
 * workspace named in `?ws=` the first time a member (not a guest) opens it.
 */
export function roomRole(
  accounts: AccountService,
  sharing: SharingService,
  user: UserRow,
  roomId: string,
  wsHint?: string,
): DocRole | undefined {
  if (roomId.startsWith("wsp_")) return accounts.roleIn(roomId, user.id) ? "edit" : undefined;
  const ws = accounts.documentWorkspace(roomId);
  if (ws) return sharing.roleFor(roomId, user.id, ws);
  if (!wsHint) return undefined;
  const role = accounts.roleIn(wsHint, user.id);
  if (!role || role === "guest") return undefined;
  accounts.registerDocument(roomId, wsHint, user.id);
  return "edit";
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export function redactUrl(url: string): string {
  return url.replace(/([?&]access_token=)[^&]*/g, "$1[redacted]");
}

export const DOC_ID = /^[a-z]{3}_[0-9a-z]{10,40}$/;

export async function buildApp(
  config: ServerConfig,
  opts: {
    db?: Db;
    logger?: boolean;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    blobs?: BlobStore;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: ["req.headers.authorization", "req.headers.cookie"],
            serializers: {
              // Tokens in the sync socket's query string must not reach the logs.
              req: (req: { method: string; url: string; hostname?: string; ip?: string }) => ({
                method: req.method,
                url: redactUrl(req.url),
                host: req.hostname,
                remoteAddress: req.ip,
              }),
            },
          },
    bodyLimit: 10 * 1024 * 1024,
  });
  const db = opts.db ?? openDatabase(config.dataDir);
  const docs = new DocStore(db);
  const rooms = new RoomManager(docs);
  const accounts = new AccountService(db);
  const sharing = new SharingService(db, accounts);
  app.decorate("ctx", { config, db, docs, rooms, accounts, sharing });

  corsPlugin(app, opts.env ?? process.env);
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 * 1024 } });
  authPlugin(app, {
    accounts,
    mailer: createMailer(opts.env ?? process.env, app.log),
    publicUrl: config.publicUrl.replace(/\/+$/, ""),
    env: opts.env ?? process.env,
    fetchImpl: opts.fetchImpl,
  });
  historyPlugin(app, { db, accounts, sharing });
  const blobs = opts.blobs ?? createBlobStore(opts.env ?? process.env, config.dataDir);
  // Object storage may still be starting (e.g. in Docker Compose); give it a little while.
  for (let attempt = 1; ; attempt++) {
    try {
      await blobs.init();
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      app.log.warn({ err: (err as Error).message, attempt }, "object storage not ready, retrying");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  uploadsPlugin(app, { db, store: blobs });
  sharingPlugin(app, { accounts, sharing, rooms, docs, publicUrl: config.publicUrl.replace(/\/+$/, "") });

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
      const role = roomRole(accounts, sharing, req.user, docId, req.query.ws);
      if (!role) {
        socket.close(4403, "no access");
        return;
      }
      const handle = rooms.join(
        docId,
        {
          send: (data) => {
            if (socket.readyState === socket.OPEN) socket.send(data);
          },
          close: () => socket.close(1001, "server shutting down"),
        },
        { writableRoots: WRITABLE_ROOTS[role] },
      );
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
            if (err instanceof ReadOnlyError) {
              socket.close(4403, "read only");
              return;
            }
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
