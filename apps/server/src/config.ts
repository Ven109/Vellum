import { resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Directory with the built web app to serve, if any. */
  webDist?: string;
  /** Public URL of this instance, used in links and emails. */
  publicUrl: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 8787);
  const host = env.HOST ?? "127.0.0.1";
  return {
    host,
    port,
    dataDir: resolve(env.VELLUM_DATA_DIR ?? "./data"),
    webDist: env.VELLUM_WEB_DIST ? resolve(env.VELLUM_WEB_DIST) : undefined,
    publicUrl: env.VELLUM_PUBLIC_URL ?? `http://localhost:${port}`,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
