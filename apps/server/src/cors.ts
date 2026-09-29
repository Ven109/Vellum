import type { FastifyInstance } from "fastify";

/**
 * Cross-origin access for Vellum apps that don't run on this server's origin — the desktop app
 * (app://vellum) and any origins listed in VELLUM_CORS_ORIGINS. They authenticate with bearer tokens,
 * never cookies, so credentials are not allowed cross-origin.
 */
export function corsPlugin(app: FastifyInstance, env: NodeJS.ProcessEnv) {
  const allowed = new Set([
    "app://vellum",
    ...(env.VELLUM_CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ]);

  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin) || !(req.url.startsWith("/api/") || req.url.startsWith("/files/")))
      return;
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    if (req.method === "OPTIONS") {
      reply.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE");
      reply.header(
        "access-control-allow-headers",
        "authorization, content-type, x-vellum-token, x-vellum-upload",
      );
      reply.header("access-control-max-age", "600");
      return reply.code(204).send();
    }
  });
}
