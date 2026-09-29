import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { AuthError } from "./auth/service.js";
import type { BlobStore } from "./storage.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Recognise image formats by their first bytes; the declared type is not trusted. SVG is refused. */
export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { type: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { type: "image/jpeg", ext: "jpg" };
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return { type: "image/gif", ext: "gif" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
    return { type: "image/webp", ext: "webp" };
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73)))
    return { type: "image/avif", ext: "avif" };
  return null;
}

/**
 * Image uploads. Files are named by an unguessable id and served from /files/<id> with a long cache
 * lifetime, so documents (and public pages) can show them without extra sign-in round-trips.
 */
export function uploadsPlugin(app: FastifyInstance, deps: { db: Db; store: BlobStore }) {
  const { db, store } = deps;

  app.addContentTypeParser(
    /^(image\/|application\/octet-stream)/,
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post("/api/uploads", { bodyLimit: MAX_UPLOAD_BYTES }, async (req) => {
    if (!req.user) throw new AuthError(401, "unauthenticated", "Sign in to continue.");
    const body = req.body;
    if (!(body instanceof Buffer) || body.length === 0)
      throw new AuthError(400, "empty", "Choose an image to upload.");
    const kind = sniffImage(body);
    if (!kind)
      throw new AuthError(415, "unsupported", "Only PNG, JPEG, GIF, WebP and AVIF images can be uploaded.");
    const id = `${randomBytes(18)
      .toString("base64url")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}.${kind.ext}`;
    await store.put(id, new Uint8Array(body), kind.type);
    db.prepare(
      "INSERT INTO uploads (id, user_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, req.user.id, kind.type, body.length, new Date().toISOString());
    return { url: `/files/${id}`, type: kind.type, size: body.length };
  });

  app.get<{ Params: { name: string } }>("/files/:name", async (req, reply) => {
    const row = db.prepare("SELECT content_type FROM uploads WHERE id = ?").get(req.params.name) as
      { content_type: string } | undefined;
    const data = row ? await store.get(req.params.name) : null;
    if (!row || !data) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-type", row.content_type)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'")
      .send(Buffer.from(data));
  });
}
