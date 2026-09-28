import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "./config.js";
import { openDatabase } from "./db.js";
import type { Db } from "./db.js";
import { DocStore } from "./doc-store.js";
import { RoomManager } from "./rooms.js";

export interface AppContext {
  config: ServerConfig;
  db: Db;
  docs: DocStore;
  rooms: RoomManager;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export const DOC_ID = /^[a-z]{3}_[0-9a-z]{10,40}$/;

export async function buildApp(
  config: ServerConfig,
  opts: { db?: Db; logger?: boolean } = {},
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
  app.decorate("ctx", { config, db, docs, rooms });

  await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 * 1024 } });

  app.get("/api/health", async () => ({
    ok: true,
    name: "vellum",
    version: process.env.VELLUM_VERSION ?? "dev",
  }));

  app.get<{ Params: { docId: string } }>("/sync/:docId", { websocket: true }, (socket, req) => {
    const { docId } = req.params;
    if (!DOC_ID.test(docId)) {
      socket.close(4400, "invalid document id");
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
  });

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
