import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { connect, cookieFrom, setupAdmin, until } from "./helpers.js";

let app: FastifyInstance;
let db: Db;
let admin: Awaited<ReturnType<typeof setupAdmin>>;
const DOC = "doc_01historyhistoryhisto";

const json = (method: "POST" | "PATCH" | "GET" | "PUT", url: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method,
    url,
    ...(payload !== undefined || method !== "GET" ? { payload: (payload ?? {}) as object } : {}),
    headers: cookie ? { cookie } : {},
  });

const version = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  author: { kind: "user", userId: "someone-else" },
  reason: "autosave",
  stats: { wordsAdded: 1, wordsRemoved: 0, wordCount: 3 },
  markdown: `text ${id}`,
  title: "Notes",
  ...extra,
});

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = await buildApp(loadConfig({ PORT: "0" }), { db, logger: false, env: {} });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  admin = await setupAdmin(app);
  const c = await connect(base, `${DOC}?ws=${admin.workspaceId}`, new Y.Doc(), { cookie: admin.cookie });
  await until(() => c.session.isSynced);
  await c.close();
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe("version history", () => {
  it("stores versions attributed to the uploader, lists them without content, and returns one in full", async () => {
    const res = await json(
      "POST",
      `/api/documents/${DOC}/versions`,
      version("ver_1", new Date().toISOString()),
      admin.cookie,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().author).toEqual({ kind: "user", userId: admin.userId });

    await json(
      "POST",
      `/api/documents/${DOC}/versions`,
      version("ver_2", new Date().toISOString(), {
        reason: "assistant",
        author: { kind: "assistant", providerId: "p", model: "m", requestedBy: "forged" },
      }),
      admin.cookie,
    );
    const list = (await json("GET", `/api/documents/${DOC}/versions`, undefined, admin.cookie)).json();
    expect(list.map((v: { id: string }) => v.id)).toEqual(["ver_2", "ver_1"]);
    expect(list[0].markdown).toBeUndefined();
    expect(list[0].author.requestedBy).toBe(admin.userId);
    const one = (await json("GET", `/api/documents/${DOC}/versions/ver_1`, undefined, admin.cookie)).json();
    expect(one.markdown).toBe("text ver_1");
  });

  it("prunes by the workspace's retention policy but never a named version", async () => {
    // Naming later also protects a version.
    await json(
      "POST",
      `/api/documents/${DOC}/versions`,
      version("ver_renamed", new Date().toISOString()),
      admin.cookie,
    );
    await json("PATCH", `/api/documents/${DOC}/versions/ver_renamed`, { name: "Checkpoint" }, admin.cookie);
    await json(
      "PUT",
      `/api/workspaces/${admin.workspaceId}/retention`,
      { keepAllForDays: 1, keepDailyForDays: 0 },
      admin.cookie,
    );
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await json("POST", `/api/documents/${DOC}/versions`, version("ver_old", old), admin.cookie);
    await json(
      "POST",
      `/api/documents/${DOC}/versions`,
      version("ver_named", old, { name: "Sent to editor", reason: "named" }),
      admin.cookie,
    );
    await json(
      "POST",
      `/api/documents/${DOC}/versions`,
      version("ver_new", new Date().toISOString()),
      admin.cookie,
    );
    const ids = (await json("GET", `/api/documents/${DOC}/versions`, undefined, admin.cookie))
      .json()
      .map((v: { id: string; name?: string }) => [v.id, v.name]);
    expect(ids).toEqual([
      ["ver_new", undefined],
      ["ver_renamed", "Checkpoint"],
      ["ver_named", "Sent to editor"],
    ]);
  });

  it("limits who can read, write and set retention", async () => {
    await json("PATCH", "/api/admin/settings", { signupsEnabled: true }, admin.cookie);
    const eve = cookieFrom(
      await json("POST", "/api/auth/signup", {
        email: "eve@example.com",
        name: "Eve",
        password: "eve's long password",
      }),
    );
    expect((await json("GET", `/api/documents/${DOC}/versions`, undefined, eve)).statusCode).toBe(403);
    await json(
      "POST",
      `/api/documents/${DOC}/shares`,
      { email: "eve@example.com", role: "comment" },
      admin.cookie,
    );
    expect((await json("GET", `/api/documents/${DOC}/versions`, undefined, eve)).statusCode).toBe(200);
    expect(
      (await json("POST", `/api/documents/${DOC}/versions`, version("ver_x", new Date().toISOString()), eve))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await json(
          "PUT",
          `/api/workspaces/${admin.workspaceId}/retention`,
          { keepAllForDays: 1, keepDailyForDays: 1 },
          eve,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await json(
          "PUT",
          `/api/workspaces/${admin.workspaceId}/retention`,
          { keepAllForDays: 0 },
          admin.cookie,
        )
      ).statusCode,
    ).toBe(400);
  });
});
