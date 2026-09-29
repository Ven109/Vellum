import { sync } from "@vellum/core";
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
let headers: Record<string, string>;
let ws: string;
const DOC = "doc_01abcdefghjkmnpqrstv";

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = await buildApp(loadConfig({ PORT: "0" }), { db, logger: false });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const admin = await setupAdmin(app);
  headers = { cookie: admin.cookie };
  ws = admin.workspaceId;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("sync server", () => {
  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toMatchObject({ ok: true, name: "vellum" });
  });

  it("relays edits between clients and acknowledges persisted updates", async () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ca = await connect(base, `${DOC}?ws=${ws}`, a, headers);
    const cb = await connect(base, `${DOC}?ws=${ws}`, b, headers);
    a.getText("t").insert(0, "hello from a");
    await until(() => b.getText("t").toString() === "hello from a");
    await until(() => ca.acks.some((sv) => sync.stateVectorCovers(sv, Y.encodeStateVector(a))));
    expect(app.ctx.docs.load(DOC).getText("t").toString()).toBe("hello from a");
    await ca.close();
    await cb.close();
  });

  it("persists across reconnects and merges offline edits", async () => {
    const a = new Y.Doc();
    let ca = await connect(base, `${DOC}?ws=${ws}`, a, headers);
    a.getText("t").insert(0, "one");
    await until(() => ca.acks.some((sv) => sync.stateVectorCovers(sv, Y.encodeStateVector(a))));
    await ca.close();
    expect(app.ctx.rooms.openRooms).toBe(0);

    // Offline edit on a, concurrent edit on a fresh client b.
    a.getText("t").insert(3, " two");
    const b = new Y.Doc();
    const cb = await connect(base, `${DOC}?ws=${ws}`, b, headers);
    await until(() => b.getText("t").toString() === "one");
    b.getText("t").insert(0, "zero ");
    ca = await connect(base, `${DOC}?ws=${ws}`, a, headers);
    await until(() => a.getText("t").toString() === b.getText("t").toString() && a.getText("t").length > 8);
    expect(a.getText("t").toString()).toBe("zero one two");
    await ca.close();
    await cb.close();
  });

  it("rejects invalid document ids", async () => {
    const doc = new Y.Doc();
    const c = await connect(base, "../../etc", doc, headers).catch((e: Error) => e);
    if (c instanceof Error) expect(c).toBeInstanceOf(Error);
    else {
      await until(() => c.ws.readyState === c.ws.CLOSED);
      expect(c.ws.readyState).toBe(c.ws.CLOSED);
    }
  });

  it("compacts stored updates", () => {
    const doc = new Y.Doc();
    doc.on("update", (u: Uint8Array) => app.ctx.docs.append(DOC, u));
    for (let i = 0; i < 10; i++) doc.getText("t").insert(i, "x");
    expect(app.ctx.docs.count(DOC)).toBe(10);
    app.ctx.docs.compact(DOC);
    expect(app.ctx.docs.count(DOC)).toBe(1);
    expect(app.ctx.docs.load(DOC).getText("t").toString()).toBe("xxxxxxxxxx");
  });
});
