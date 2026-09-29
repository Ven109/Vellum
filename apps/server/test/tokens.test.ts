import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { connect, setupAdmin, until } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let base: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = await buildApp(loadConfig({ PORT: "0" }), {
    db,
    logger: false,
    env: { VELLUM_CORS_ORIGINS: "https://writer.example" },
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe("apps on other origins (desktop)", () => {
  it("get a bearer token when they ask for one, and it works like the cookie", async () => {
    await setupAdmin(app);
    const plain = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "correct horse battery" },
    });
    expect(plain.json().token).toBeUndefined();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-vellum-token": "1" },
      payload: { email: "admin@example.com", password: "correct horse battery" },
    });
    const { token, workspaces } = res.json();
    expect(token).toMatch(/^[\w-]{20,}$/);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().user.email).toBe("admin@example.com");

    // The sync socket accepts the token as a query parameter (browsers can't set headers on WebSockets).
    const doc = new Y.Doc();
    const c = await connect(
      base,
      `doc_01tokentokentokentokentok?ws=${workspaces[0].id}&access_token=${token}`,
      doc,
    );
    await until(() => c.session.isSynced);
    await c.close();

    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("allows CORS only for the desktop app and configured origins, without credentials", async () => {
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/login",
      headers: { origin: "app://vellum", "access-control-request-method": "POST" },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("app://vellum");
    expect(pre.headers["access-control-allow-headers"]).toContain("authorization");
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();

    const configured = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://writer.example" },
    });
    expect(configured.headers["access-control-allow-origin"]).toBe("https://writer.example");

    const other = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("workspace document list", () => {
  it("lists registered documents with their titles for members", async () => {
    const admin = await setupAdmin(app);
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "From another device");
    const c = await connect(base, `doc_01listlistlistlistlistli?ws=${admin.workspaceId}`, doc, {
      cookie: admin.cookie,
    });
    await until(() => c.acks.length > 0);
    await c.close();
    const res = await app.inject({
      method: "GET",
      url: `/api/workspaces/${admin.workspaceId}/documents`,
      headers: { cookie: admin.cookie },
    });
    const [listed] = res.json() as Array<{ id: string; title: string; createdBy: string; version: number }>;
    expect(listed).toMatchObject({
      id: "doc_01listlistlistlistlistli",
      title: "From another device",
      createdBy: admin.userId,
    });
    // The version moves when the document changes, so clients know what to sync.
    expect(listed!.version).toBeGreaterThan(0);
    const again = new Y.Doc();
    const c2 = await connect(base, `doc_01listlistlistlistlistli?ws=${admin.workspaceId}`, again, {
      cookie: admin.cookie,
    });
    await until(() => again.getText("title").length > 0);
    again.getText("title").insert(0, "Renamed: ");
    await until(() => c2.acks.length > 1);
    await c2.close();
    const after = (
      await app.inject({
        method: "GET",
        url: `/api/workspaces/${admin.workspaceId}/documents`,
        headers: { cookie: admin.cookie },
      })
    ).json() as Array<{ title: string; version: number }>;
    expect(after[0]!.version).toBeGreaterThan(listed!.version);
    expect(after[0]!.title).toBe("Renamed: From another device");
    expect(
      (await app.inject({ method: "GET", url: `/api/workspaces/${admin.workspaceId}/documents` })).statusCode,
    ).toBe(401);
  });
});

describe("logging", () => {
  it("redacts access tokens from logged URLs", async () => {
    const { redactUrl } = await import("../src/app.js");
    expect(redactUrl("/sync/doc_1?ws=wsp_1&access_token=secret123")).toBe(
      "/sync/doc_1?ws=wsp_1&access_token=[redacted]",
    );
    expect(redactUrl("/sync/doc_1?access_token=abc&ws=x")).toBe("/sync/doc_1?access_token=[redacted]&ws=x");
  });
});
